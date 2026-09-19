import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.abdulrehman.nexuswatch",
  appName: "Nexus Watch Protocol",
  webDir: "mobile-dist",
  backgroundColor: "#0b0e14",
  android: {
    backgroundColor: "#0b0e14",
  },
  server: {
    androidScheme: "https",
  },
};

export default config;
