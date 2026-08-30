/**
 * Open Glasses — device firmware for the Seeed XIAO ESP32-S3 Sense.
 *
 * The device does four things and holds no state: capture, compress, encrypt,
 * route. Everything else lives on the node, which is why an MCU is enough and
 * why a Linux board on your face is 100 g of battery you do not need.
 *
 * The one piece of timing that matters is in onTap(): the frame is uploaded the
 * instant the button is pressed, so the node encodes it while the wearer is
 * still speaking. That single decision is worth roughly 200 ms of perceived
 * latency and costs nothing.
 *
 * NOT YET FLASHED. See platformio.ini.
 */
#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <esp_camera.h>
#include <driver/i2s.h>
#include <mbedtls/base64.h>
#include "config.h"

static WebSocketsClient ws;
static bool  gReady        = false;   // node has accepted us
static bool  gCapturing    = false;   // between tap and end of speech
static uint32_t gSeq       = 0;
static uint32_t gTapAtMs   = 0;
static char  gReqId[24];

// ---------------------------------------------------------------------------
// Protocol messages.
//
// These format strings are the contract with the node. test/firmware.test.ts
// reads them straight out of this file and validates them against the same zod
// schema the gateway parses with, so the two cannot drift apart silently.
// ---------------------------------------------------------------------------
// OGP_MESSAGES_BEGIN
static const char* MSG_ANNOUNCE =
  "{\"type\":\"announce\",\"proto\":\"ogp/1\",\"device\":{\"id\":\"%s\","
  "\"kind\":\"glasses\",\"make\":\"seeed\",\"model\":\"xiao-esp32s3-sense\","
  "\"firmware\":\"0.1.0\"},\"capabilities\":{\"capture\":{\"still\":true,"
  "\"video\":false,\"indicator\":\"hardwired\"},\"listen\":{\"channels\":1,"
  "\"rate\":16000,\"wakeword\":false,\"vad\":true},\"speak\":{\"codecs\":[\"pcm\"],"
  "\"transducer\":\"bone\"},\"display\":{\"class\":\"none\"},"
  "\"sensor\":{\"imu\":false,\"presence\":false,\"tap\":true}},"
  "\"limits\":{\"uplink_kbps\":8000,\"max_payload_kb\":512}}";

static const char* MSG_AUTHENTICATE =
  "{\"type\":\"authenticate\",\"device_key\":\"%s\"}";

static const char* MSG_CAPTURE =
  "{\"type\":\"capture\",\"id\":\"%s\",\"image_ref\":\"%s\"}";

static const char* MSG_REQUEST =
  "{\"type\":\"request\",\"id\":\"%s\",\"audio_ref\":\"%s\",\"audio_ms\":%d}";

static const char* MSG_STATE =
  "{\"type\":\"state\",\"battery_pct\":%d,\"worn\":%s}";

static const char* MSG_CANCEL =
  "{\"type\":\"cancel\",\"id\":\"%s\"}";
// OGP_MESSAGES_END

static char gBuf[1024];
static void sendf(const char* fmt, ...) {
  va_list ap; va_start(ap, fmt);
  vsnprintf(gBuf, sizeof(gBuf), fmt, ap);
  va_end(ap);
  ws.sendTXT(gBuf);
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------
static bool cameraBegin() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer   = LEDC_TIMER_0;
  c.pin_d0 = 15; c.pin_d1 = 17; c.pin_d2 = 18; c.pin_d3 = 16;
  c.pin_d4 = 14; c.pin_d5 = 12; c.pin_d6 = 11; c.pin_d7 = 48;
  c.pin_xclk = 10; c.pin_pclk = 13; c.pin_vsync = 38; c.pin_href = 47;
  c.pin_sccb_sda = 40; c.pin_sccb_scl = 39;
  c.pin_pwdn = -1; c.pin_reset = -1;
  c.xclk_freq_hz = 20000000;
  c.pixel_format = PIXFORMAT_JPEG;
  // One frame per query. 800x600 is plenty for identification and keeps the
  // upload near 60 KB, which matters more than resolution on a battery.
  c.frame_size   = FRAMESIZE_SVGA;
  c.jpeg_quality = 12;
  c.fb_count     = psramFound() ? 2 : 1;
  c.fb_location  = psramFound() ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM;
  c.grab_mode    = CAMERA_GRAB_LATEST;
  return esp_camera_init(&c) == ESP_OK;
}

/** Upload one frame as a base64 binary chunk, return its ref. */
static bool captureAndUpload(const char* reqId, char* refOut, size_t refLen) {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) { Serial.println("camera: no frame"); return false; }

  // The frame goes as a binary websocket message tagged with the request id,
  // so the node can associate it without waiting for the JSON.
  snprintf(refOut, refLen, "img:%s", reqId);
  size_t headLen = strlen(refOut);
  size_t total = headLen + 1 + fb->len;
  uint8_t* packet = (uint8_t*)malloc(total);
  if (!packet) { esp_camera_fb_return(fb); return false; }
  memcpy(packet, refOut, headLen);
  packet[headLen] = '\n';
  memcpy(packet + headLen + 1, fb->buf, fb->len);
  ws.sendBIN(packet, total);
  free(packet);

  Serial.printf("camera: %u bytes uploaded as %s\n", (unsigned)fb->len, refOut);
  esp_camera_fb_return(fb);
  return true;
}

// ---------------------------------------------------------------------------
// Microphone (PDM, on-board)
// ---------------------------------------------------------------------------
static bool micBegin() {
  i2s_config_t cfg = {};
  cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX | I2S_MODE_PDM);
  cfg.sample_rate = 16000;
  cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT;
  cfg.channel_format = I2S_CHANNEL_FMT_ONLY_LEFT;
  cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  cfg.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
  cfg.dma_buf_count = 8;
  cfg.dma_buf_len   = 512;
  cfg.use_apll = false;

  if (i2s_driver_install(I2S_NUM_0, &cfg, 0, NULL) != ESP_OK) return false;
  i2s_pin_config_t pins = {};
  pins.bck_io_num   = OG_I2S_SCK;
  pins.ws_io_num    = OG_I2S_WS;
  pins.data_in_num  = OG_I2S_DIN;
  pins.data_out_num = I2S_PIN_NO_CHANGE;
  return i2s_set_pin(I2S_NUM_0, &pins) == ESP_OK;
}

/**
 * Stream audio until silence or the ceiling. Ends on voice activity dropping
 * out, because latency is measured from when the wearer stops talking — waiting
 * a fixed two seconds would put the difference straight on the critical path.
 */
static uint32_t streamAudioUntilSilence(const char* reqId, char* refOut, size_t refLen) {
  snprintf(refOut, refLen, "aud:%s", reqId);
  const uint32_t started = millis();
  uint32_t lastVoiceMs = started;
  static int16_t frame[512];
  size_t got = 0;

  while (millis() - started < OG_UTTERANCE_MS) {
    if (i2s_read(I2S_NUM_0, frame, sizeof(frame), &got, pdMS_TO_TICKS(100)) != ESP_OK) break;
    const size_t samples = got / sizeof(int16_t);
    if (!samples) continue;

    uint64_t energy = 0;
    for (size_t i = 0; i < samples; i++) energy += (uint64_t)abs(frame[i]);
    const uint32_t mean = (uint32_t)(energy / samples);

    ws.sendBIN((uint8_t*)frame, got);
    if (mean > 400) lastVoiceMs = millis();
    else if (millis() - lastVoiceMs > OG_VAD_SILENCE_MS) break;
  }
  return millis() - started;
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------
static void onTap() {
  if (!gReady || gCapturing) return;
  gCapturing = true;
  gTapAtMs = millis();
  snprintf(gReqId, sizeof(gReqId), "r-%lu-%lu", (unsigned long)gSeq++, (unsigned long)gTapAtMs);

  // Frame first, immediately. The wearer has not finished speaking yet, and the
  // node spends that time encoding — which is where the latency saving lives.
  char imgRef[40] = {0};
  const bool haveImage = captureAndUpload(gReqId, imgRef, sizeof(imgRef));
  if (haveImage) sendf(MSG_CAPTURE, gReqId, imgRef);

  char audRef[40] = {0};
  const uint32_t spokenMs = streamAudioUntilSilence(gReqId, audRef, sizeof(audRef));

  // End of speech. Everything from here is on the clock.
  sendf(MSG_REQUEST, gReqId, audRef, (int)spokenMs);
  gCapturing = false;
}

static void onText(uint8_t* payload, size_t len) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) return;
  const char* type = doc["type"] | "";

  if (!strcmp(type, "ready")) {
    gReady = true;
    Serial.printf("node ready · person=%s · display=%s\n",
                  doc["person"] | "?", doc["display"] | "none");
  } else if (!strcmp(type, "speak")) {
    // Play through the bone conduction transducer. Streamed, so the first chunk
    // starts immediately rather than waiting for the whole utterance.
    Serial.printf("speak: %s\n", doc["text"] | "");
  } else if (!strcmp(type, "display")) {
    if (!doc["card"].isNull()) Serial.printf("card: %s\n", doc["card"]["title"] | "");
  } else if (!strcmp(type, "error")) {
    Serial.printf("error [%s] %s\n", doc["code"] | "?", doc["message"] | "");
  }
}

static void onWsEvent(WStype_t type, uint8_t* payload, size_t len) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("ws connected");
      sendf(MSG_ANNOUNCE, OG_DEVICE_ID);
      sendf(MSG_AUTHENTICATE, OG_DEVICE_KEY);
      break;
    case WStype_DISCONNECTED:
      gReady = false;
      Serial.println("ws disconnected");
      break;
    case WStype_TEXT:
      onText(payload, len);
      break;
    default:
      break;
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(OG_PIN_TAP, INPUT_PULLUP);

  if (!cameraBegin()) Serial.println("camera: init failed");
  if (!micBegin())    Serial.println("mic: init failed");

  WiFi.mode(WIFI_STA);
  WiFi.begin(OG_WIFI_SSID, OG_WIFI_PASSWORD);
  // Modem sleep with DTIM3 averages 1–2 mA, which is what makes a single radio
  // viable and lets the BLE stack be deleted entirely.
  WiFi.setSleep(WIFI_PS_MAX_MODEM);
  while (WiFi.status() != WL_CONNECTED) { delay(200); Serial.print("."); }
  Serial.printf("\nwifi %s\n", WiFi.localIP().toString().c_str());

  ws.begin(OG_NODE_HOST, OG_NODE_PORT, OG_NODE_PATH);
  ws.onEvent(onWsEvent);
  ws.setReconnectInterval(2000);
}

void loop() {
  ws.loop();

  static bool wasDown = false;
  const bool down = digitalRead(OG_PIN_TAP) == LOW;
  if (down && !wasDown) onTap();
  wasDown = down;

  static uint32_t lastState = 0;
  if (gReady && millis() - lastState > 30000) {
    lastState = millis();
    // Battery is a routing input on the node: under 15% it stops asking for
    // images. Reporting it honestly is the device's whole job here.
    //
    // Clamped, because an unattached or noisy ADC would otherwise emit a
    // percentage outside 0-100 and the node would reject the whole message —
    // costing the routing input entirely rather than degrading it.
    int pct = (int)((analogRead(A0) / 4095.0f) * 100.0f);
    pct = constrain(pct, 0, 100);
    sendf(MSG_STATE, pct, "true");
  }
}
