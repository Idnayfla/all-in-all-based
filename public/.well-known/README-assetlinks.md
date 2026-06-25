# assetlinks.json — adding the Play App Signing fingerprint

`assetlinks.json` currently contains **one** SHA-256 fingerprint: Hus's local
**debug** signing key (used for sideloaded/debug builds and OAuth testing).

When the app is uploaded to Play Console, Google re-signs it with its own
**Play App Signing** key. App Links (and therefore Google OAuth via Custom Tab)
will only verify in the Play-distributed build once that key's fingerprint is
also listed here. Until then, OAuth breaks in the Play build.

## Steps (do this right after creating the app in Play Console)

1. Play Console → your app → **Setup → App integrity → App signing**.
2. Copy the **SHA-256 certificate fingerprint** under **App signing key
   certificate** (colon-separated hex, e.g. `AB:CD:12:...`).
3. Add it as a **second** entry in the `sha256_cert_fingerprints` array in
   `public/.well-known/assetlinks.json`. Final shape:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "dev.getbased.app",
      "sha256_cert_fingerprints": [
        "E4:C5:33:18:B4:E3:2C:E7:59:20:0F:47:A2:73:66:5D:81:6D:96:F7:44:D1:BF:EE:00:17:63:B7:C1:CF:33:CB",
        "PASTE_PLAY_APP_SIGNING_SHA256_HERE"
      ]
    }
  }
]
```

4. Commit, push, **deploy to production** (getbased.dev must serve the updated
   file — it's fetched from `https://getbased.dev/.well-known/assetlinks.json`).
5. Verify: open `https://getbased.dev/.well-known/assetlinks.json` in a browser
   and confirm both fingerprints are present. Optionally run it through Google's
   Statement List Generator/Tester.

> Keep BOTH fingerprints. Removing the debug one breaks local/sideload OAuth.
