#pragma once

// Copy to config_local.h and edit, or set these with -D build flags.
#define OG_WIFI_SSID      "homenode-5g"
#define OG_WIFI_PASSWORD  "change-me"

// The node. Over WireGuard this is the tunnel address; on the LAN it is the
// node's own. The device always dials out — the node never dials in.
#define OG_NODE_HOST      "10.8.0.2"
#define OG_NODE_PORT      8787
#define OG_NODE_PATH      "/"

#define OG_DEVICE_ID      "glasses-matt"
#define OG_DEVICE_KEY     "devkey-matt-0001"

// How long we listen after a tap before deciding the sentence is over.
#define OG_UTTERANCE_MS   2500
// Silence that ends an utterance early.
#define OG_VAD_SILENCE_MS 600

// XIAO ESP32-S3 Sense pin map.
#define OG_PIN_TAP        D1
#define OG_I2S_WS         42
#define OG_I2S_SCK        -1   // PDM microphone: no bit clock
#define OG_I2S_DIN        41
