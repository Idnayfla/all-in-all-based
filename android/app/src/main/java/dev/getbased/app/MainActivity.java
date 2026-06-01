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

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                view.loadUrl(url);
                return true;
            }
        });

        webView.setWebChromeClient(new android.webkit.WebChromeClient() {
            @Override
            public void onPermissionRequest(android.webkit.PermissionRequest request) {
                request.grant(request.getResources());
            }
        });

        webView.setBackgroundColor(Color.parseColor("#0a0a0f"));
        webView.loadUrl(MAIN_URL);
        setContentView(webView);
        startBubbleService();
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
