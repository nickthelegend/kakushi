import type { ExpoConfig } from "expo/config";

// The passkey domain (WebAuthn relying party ID). Passkeys only work once this host serves
// /.well-known/apple-app-site-association (iOS) and /.well-known/assetlinks.json (Android) naming
// this app; see README.md "Passkey domain". Set KAKUSHI_FHE_PASSKEY_DOMAIN before `expo prebuild`.
const rpId = process.env.KAKUSHI_FHE_PASSKEY_DOMAIN ?? "pay.kakushi.example";
// Apple bundle id / Android package. Must match the AASA (TEAM_ID.<bundleId>) and assetlinks.json.
const appId = process.env.KAKUSHI_FHE_APP_ID ?? "xyz.kakushi.pay";

const config: ExpoConfig = {
  name: "Kakushi Pay",
  slug: "kakushi-pay",
  version: "0.1.0",
  scheme: "kakushipay",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  icon: "./assets/kakushi-fin.png",
  backgroundColor: "#021a20",
  ios: {
    bundleIdentifier: appId,
    supportsTablet: false,
    // webcredentials: passkeys for rpId. applinks: https://<rpId>/claim#... pay links and /request?... request links open the app.
    associatedDomains: [`webcredentials:${rpId}`, `applinks:${rpId}`],
    infoPlist: { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } },
  },
  android: {
    package: appId,
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          { scheme: "https", host: rpId, pathPrefix: "/claim" },
          { scheme: "https", host: rpId, pathPrefix: "/request" },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: { bundler: "metro", output: "single" },
  plugins: [["expo-secure-store", { faceIDPermission: "Allow Kakushi Pay to keep your account address on this device." }]],
  extra: { rpId, rpName: "Kakushi Pay" },
};

export default config;
