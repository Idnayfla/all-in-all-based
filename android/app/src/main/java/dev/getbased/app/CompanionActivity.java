package dev.getbased.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;

public class CompanionActivity extends AppCompatActivity {

    static final String ACTION_COMPANION_CLOSED = "dev.getbased.app.COMPANION_CLOSED";

    // Use www.getbased.dev (the canonical origin) for both the priming load and
    // the companion URL so that Supabase reads from the same localStorage origin
    // where MainActivity stored the auth token.
    private static final String PRIMING_URL  = "https://www.getbased.dev";
    private static final String COMPANION_URL = "https://www.getbased.dev/companion";
    private boolean initialLoadDone = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Transparent window background
        getWindow().setBackgroundDrawable(
                new android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT));

        // Full-screen transparent root
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.TRANSPARENT);

        // Calculate 65% of screen height
        DisplayMetrics metrics = new DisplayMetrics();
        getWindowManager().getDefaultDisplay().getMetrics(metrics);
        int panelHeight = (int) (metrics.heightPixels * 0.65f);

        // Panel container that sits at the bottom
        FrameLayout panel = new FrameLayout(this);
        panel.setBackgroundColor(Color.parseColor("#0a0a0f"));

        FrameLayout.LayoutParams panelParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                panelHeight);
        panelParams.gravity = Gravity.BOTTOM;

        // WebView
        WebView webView = new WebView(this);
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(webView, true);

        webView.setBackgroundColor(Color.parseColor("#0a0a0f"));

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                view.loadUrl(url);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // Only trigger on the canonical www root page — not on intermediate
                // redirects — so Supabase has fully initialised before we navigate.
                if (!initialLoadDone && url.equals("https://www.getbased.dev/")) {
                    initialLoadDone = true;
                    // 5 s gives Supabase time to read the stored token from localStorage
                    // and complete any silent token-refresh before we load /companion.
                    new Handler(Looper.getMainLooper()).postDelayed(
                            () -> view.loadUrl(COMPANION_URL), 5000);
                }
                if (url.contains("/companion")) {
                    view.evaluateJavascript(
                            "if (!localStorage.getItem('based_companion_voice')) {" +
                            "  localStorage.setItem('based_companion_voice', 'true');" +
                            "}",
                            null);
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }
        });

        // Load the canonical www domain directly so Supabase reads from the same
        // localStorage origin where MainActivity stored the auth token.
        // onPageFinished triggers the /companion redirect after a 5 s settle delay.
        webView.loadUrl(PRIMING_URL);

        // Request RECORD_AUDIO at runtime so the mic works in the companion page.
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                    new String[]{Manifest.permission.RECORD_AUDIO}, 1001);
        }

        panel.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        // Close button — top-right of panel
        TextView closeBtn = new TextView(this);
        closeBtn.setText("✕");
        closeBtn.setTextColor(Color.parseColor("#e0e0e0"));
        closeBtn.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 28);
        closeBtn.setPadding(dpToPx(16), dpToPx(12), dpToPx(16), dpToPx(12));
        closeBtn.setGravity(Gravity.CENTER);
        closeBtn.setOnClickListener(v -> finish());

        FrameLayout.LayoutParams closeBtnParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT);
        closeBtnParams.gravity = Gravity.TOP | Gravity.END;

        panel.addView(closeBtn, closeBtnParams);

        root.addView(panel, panelParams);
        setContentView(root);
    }

    @Override
    public void onBackPressed() {
        finish();
    }

    @Override
    public void finish() {
        // Notify FloatingBubbleService that the companion was closed
        Intent broadcast = new Intent(ACTION_COMPANION_CLOSED);
        sendBroadcast(broadcast);
        super.finish();
    }

    private int dpToPx(int dp) {
        return Math.round(dp * getResources().getDisplayMetrics().density);
    }
}
