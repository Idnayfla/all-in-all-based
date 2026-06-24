package dev.getbased.app;

import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.CookieManager;
import android.graphics.Color;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {

    private static final int OVERLAY_PERMISSION_REQUEST = 1001;
    static final String MAIN_URL = "https://getbased.dev";

    private boolean serviceStarted = false;
    WebView webView; // package-visible so FloatingBubbleService can reference it

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        ws.setLoadsImagesAutomatically(true);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        // Marker so the web app can detect it's running inside the Android app
        // (used to hide in-app purchase CTAs for Play Billing compliance).
        ws.setUserAgentString(ws.getUserAgentString() + " BasedApp");

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (ExternalLinks.isExternal(url)) {
                    // OAuth / external sites must open in a real browser (Custom Tab).
                    ExternalLinks.open(MainActivity.this, url);
                    return true;
                }
                return false; // let the WebView load getbased.dev itself
            }
        });

        webView.setWebChromeClient(new android.webkit.WebChromeClient() {
            @Override
            public void onPermissionRequest(android.webkit.PermissionRequest request) {
                request.grant(request.getResources());
            }
        });

        webView.setBackgroundColor(Color.parseColor("#0a0a0f"));
        // If launched via an App Link (e.g. the OAuth return getbased.dev/auth/callback),
        // load that URL so the WebView's Supabase client can complete the session.
        String deepLink = deepLinkFromIntent(getIntent());
        webView.loadUrl(deepLink != null ? deepLink : MAIN_URL);
        setContentView(webView);
        startBubbleService();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String deepLink = deepLinkFromIntent(intent);
        if (deepLink != null && webView != null) {
            webView.loadUrl(deepLink);
        }
    }

    /** Returns the getbased.dev URL if this intent is an App Link redirect, else null. */
    private String deepLinkFromIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return null;
        Uri data = intent.getData();
        if (data == null) return null;
        String host = data.getHost();
        if (host != null && (host.equals("getbased.dev") || host.endsWith(".getbased.dev"))) {
            return data.toString();
        }
        return null;
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!serviceStarted && Settings.canDrawOverlays(this)) {
            launchBubbleService();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    private void startBubbleService() {
        if (Settings.canDrawOverlays(this)) {
            launchBubbleService();
        } else {
            showOverlayExplanation();
        }
    }

    private void showOverlayExplanation() {
        new AlertDialog.Builder(this)
                .setTitle("Draw Over Other Apps")
                .setMessage(
                        "Based needs permission to show a floating bubble so you can "
                        + "access your AI companion from any screen. "
                        + "Tap OK to open the permission screen, then toggle \"Allow\" for Based.")
                .setPositiveButton("OK", (dialog, which) -> openOverlaySettings())
                .setNegativeButton("Not now", null)
                .setCancelable(false)
                .show();
    }

    private void openOverlaySettings() {
        Intent intent = new Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getPackageName())
        );
        startActivityForResult(intent, OVERLAY_PERMISSION_REQUEST);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == OVERLAY_PERMISSION_REQUEST && Settings.canDrawOverlays(this)) {
            launchBubbleService();
        }
    }

    private void launchBubbleService() {
        if (serviceStarted) return;
        serviceStarted = true;
        Intent serviceIntent = new Intent(this, FloatingBubbleService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
    }
}
