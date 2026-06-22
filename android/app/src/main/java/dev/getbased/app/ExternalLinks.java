package dev.getbased.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import androidx.browser.customtabs.CustomTabsIntent;

/**
 * Decides which URLs must leave the in-app WebView and opens them in a Chrome
 * Custom Tab. Google (and most providers) block OAuth inside embedded WebViews
 * with "disallowed_useragent", so sign-in and Google Calendar connect must run
 * in a real browser context. Our own getbased.dev pages stay in the WebView.
 */
final class ExternalLinks {
    private ExternalLinks() {}

    /** True if this URL should be handled outside the WebView. */
    static boolean isExternal(String url) {
        if (url == null) return false;
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme();
        if (scheme == null) return false;
        if (scheme.equals("http") || scheme.equals("https")) {
            String host = uri.getHost();
            if (host == null) return false;
            // Keep first-party pages in the WebView; everything else opens externally.
            return !(host.equals("getbased.dev") || host.endsWith(".getbased.dev"));
        }
        // mailto:, tel:, intent:, etc. always leave the WebView.
        return !scheme.equals("about") && !scheme.equals("javascript") && !scheme.equals("blob");
    }

    /** Opens the URL in a Chrome Custom Tab, falling back to the system browser. */
    static void open(Context ctx, String url) {
        Uri uri = Uri.parse(url);
        try {
            CustomTabsIntent tab = new CustomTabsIntent.Builder().build();
            tab.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            tab.launchUrl(ctx, uri);
        } catch (Exception e) {
            try {
                Intent view = new Intent(Intent.ACTION_VIEW, uri);
                view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(view);
            } catch (Exception ignored) {
            }
        }
    }
}
