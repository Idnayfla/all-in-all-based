package dev.getbased.app;

import android.Manifest;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;

import java.lang.ref.WeakReference;

public class CompanionActivity extends AppCompatActivity {

    static final String ACTION_COMPANION_CLOSED = "dev.getbased.app.COMPANION_CLOSED";
    static final String ACTION_CLOSE_REQUEST    = "dev.getbased.app.COMPANION_CLOSE_REQUEST";

    private static final String COMPANION_URL          = "https://www.getbased.dev/companion";
    private static final int    REQUEST_MEDIA_PROJECTION = 1002;

    private WebView webView;

    /** Receives a close request from FloatingBubbleService (bubble second-tap). */
    private final BroadcastReceiver closeRequestReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (ACTION_CLOSE_REQUEST.equals(intent.getAction())) {
                dismissSelf();
            }
        }
    };

    @Override
    protected void onResume() {
        super.onResume();
        overridePendingTransition(0, 0);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        overridePendingTransition(0, 0);
        getWindow().setWindowAnimations(0);

        getWindow().setBackgroundDrawable(
                new android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT));
        getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.TRANSPARENT);

        android.util.DisplayMetrics metrics = new android.util.DisplayMetrics();
        getWindowManager().getDefaultDisplay().getMetrics(metrics);
        int panelHeight = (int) (metrics.heightPixels * 0.65f);

        FrameLayout panel = new FrameLayout(this);
        panel.setBackgroundColor(Color.TRANSPARENT);

        FrameLayout.LayoutParams panelParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, panelHeight);
        panelParams.gravity = Gravity.BOTTOM;

        webView = new WebView(this);
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

        webView.setBackgroundColor(Color.TRANSPARENT);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                view.loadUrl(url);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (url.contains("/companion")) {
                    view.evaluateJavascript(
                            "if (!localStorage.getItem('based_companion_voice')) {" +
                            "  localStorage.setItem('based_companion_voice', 'true');" +
                            "}",
                            null);
                    view.evaluateJavascript(
                            "window.close = function() {" +
                            "  if (window.AndroidBridge) { window.AndroidBridge.close(); }" +
                            "};",
                            null);
                }
            }
        });

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }
        });

        webView.loadUrl(COMPANION_URL);

        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                    new String[]{Manifest.permission.RECORD_AUDIO}, 1001);
        }

        panel.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        TextView closeBtn = new TextView(this);
        closeBtn.setText("✕");
        closeBtn.setTextColor(Color.parseColor("#e0e0e0"));
        closeBtn.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 28);
        closeBtn.setPadding(dpToPx(16), dpToPx(12), dpToPx(16), dpToPx(12));
        closeBtn.setGravity(Gravity.CENTER);
        closeBtn.setOnClickListener(v -> dismissSelf());

        FrameLayout.LayoutParams closeBtnParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT);
        closeBtnParams.gravity = Gravity.TOP | Gravity.END;
        panel.addView(closeBtn, closeBtnParams);

        root.addView(panel, panelParams);
        setContentView(root);

        IntentFilter filter = new IntentFilter(ACTION_CLOSE_REQUEST);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(closeRequestReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(closeRequestReceiver, filter);
        }

        // Register in-process frame callback so ScreenCaptureService can deliver
        // frames directly without going through a broadcast intent.
        WeakReference<CompanionActivity> activityRef = new WeakReference<>(this);
        WeakReference<WebView>           webViewRef  = new WeakReference<>(webView);
        ScreenCaptureService.frameCallback = base64 -> {
            CompanionActivity a  = activityRef.get();
            WebView           wv = webViewRef.get();
            if (a == null || wv == null) return;
            a.runOnUiThread(() ->
                wv.evaluateJavascript(
                    "window.onScreenFrame&&window.onScreenFrame('" + base64 + "')", null));
        };
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_MEDIA_PROJECTION) return;

        if (resultCode == Activity.RESULT_OK && data != null) {
            Intent captureIntent = new Intent(this, ScreenCaptureService.class);
            captureIntent.setAction(ScreenCaptureService.ACTION_START);
            captureIntent.putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, resultCode);
            captureIntent.putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, data);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(captureIntent);
            } else {
                startService(captureIntent);
            }
            sendBroadcast(
                new Intent(ScreenCaptureService.ACTION_CAPTURE_STARTED)
                    .setPackage(getPackageName()));
        } else {
            if (webView != null) {
                webView.evaluateJavascript(
                    "window.onScreenCaptureDenied&&window.onScreenCaptureDenied()", null);
            }
        }
    }

    @Override
    public void onBackPressed() {
        dismissSelf();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        ScreenCaptureService.frameCallback = null;
        try { unregisterReceiver(closeRequestReceiver); } catch (Exception ignored) {}
    }

    @Override
    public void finish() {
        Intent broadcast = new Intent(ACTION_COMPANION_CLOSED);
        sendBroadcast(broadcast);
        super.finish();
    }

    private void dismissSelf() {
        // Stop screen capture cleanly when the companion is closed
        Intent stopCapture = new Intent(this, ScreenCaptureService.class);
        stopCapture.setAction(ScreenCaptureService.ACTION_STOP);
        startService(stopCapture);
        sendBroadcast(
            new Intent(ScreenCaptureService.ACTION_CAPTURE_STOPPED)
                .setPackage(getPackageName()));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            finishAndRemoveTask();
        } else {
            finish();
        }
        overridePendingTransition(0, 0);
    }

    /** Exposed to JavaScript as window.AndroidBridge */
    private class AndroidBridge {
        @JavascriptInterface
        public void close() {
            runOnUiThread(() -> dismissSelf());
        }

        @JavascriptInterface
        public void startScreenCapture() {
            runOnUiThread(() -> {
                MediaProjectionManager mpm =
                    (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
                startActivityForResult(mpm.createScreenCaptureIntent(), REQUEST_MEDIA_PROJECTION);
            });
        }

        @JavascriptInterface
        public void stopScreenCapture() {
            Intent stopIntent = new Intent(CompanionActivity.this, ScreenCaptureService.class);
            stopIntent.setAction(ScreenCaptureService.ACTION_STOP);
            startService(stopIntent);
            sendBroadcast(
                new Intent(ScreenCaptureService.ACTION_CAPTURE_STOPPED)
                    .setPackage(getPackageName()));
            if (webView != null) {
                runOnUiThread(() ->
                    webView.evaluateJavascript(
                        "window.onScreenCaptureStopped&&window.onScreenCaptureStopped()", null));
            }
        }
    }

    private int dpToPx(int dp) {
        return Math.round(dp * getResources().getDisplayMetrics().density);
    }
}
