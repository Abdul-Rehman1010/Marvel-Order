import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.abdulrehman.nexuswatch",
  appName: "Doom Flix",
  webDir: "mobile-dist",
  backgroundColor: "#070b08",
  android: {
    backgroundColor: "#070b08",
  },
  server: {
    androidScheme: "https",
  },
};

export default config;
