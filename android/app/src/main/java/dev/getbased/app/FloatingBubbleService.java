package dev.getbased.app;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.AnimatorSet;
import android.animation.Keyframe;
import android.animation.ObjectAnimator;
import android.animation.PropertyValuesHolder;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffColorFilter;
import android.graphics.Typeface;
import android.os.Build;
import android.os.IBinder;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewTreeObserver;
import android.view.WindowManager;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.view.animation.AccelerateInterpolator;
import android.view.animation.LinearInterpolator;
import android.view.animation.OvershootInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;

public class FloatingBubbleService extends Service {

    // ── Constants ──────────────────────────────────────────────────────────────
    private static final String CHANNEL_ID                  = "based_bubble";
    private static final int    BUBBLE_SIZE_DP              = 56;
    private static final int    NOTIFICATION_ID             = 1001;
    static final String         ACTION_BUBBLE_THINKING      = "dev.getbased.app.BUBBLE_THINKING";
    static final String         EXTRA_THINKING_ACTIVE       = "active";

    // ── Feature 7: Companion name ──────────────────────────────────────────────
    static final String  ACTION_UPDATE_NAME  = "dev.getbased.app.UPDATE_COMPANION_NAME";
    static final String  EXTRA_NAME          = "name";
    static String        companionName       = "Based";

    // ── Speaking state broadcast ───────────────────────────────────────────────
    static final String ACTION_BUBBLE_SPEAKING = "dev.getbased.app.BUBBLE_SPEAKING";
    static final String EXTRA_SPEAKING_ACTIVE  = "speaking";
    static final String EXTRA_SPEAKING_TEXT    = "text";

    // ── Proactive engine ───────────────────────────────────────────────────────
    private static final long PROACTIVE_INTERVAL_MS = 3L * 60 * 1000;
    private static final long MIN_IDLE_MS            = 60L * 1000;
    private static final long MAX_IDLE_MS            = 30L * 60 * 1000;
    private static final long MIN_TRIGGER_GAP_MS     = 2L * 60 * 60 * 1000;

    // ── Feature 8: Evolution tracking ─────────────────────────────────────────
    private static final String PREFS_NAME          = "based_prefs";
    private static final String KEY_FIRST_LAUNCH    = "based_first_launch";
    private long                daysActive          = 0;

    // ── Window / view ──────────────────────────────────────────────────────────
    private WindowManager windowManager;
    private View          bubbleView;       // outer container (added to WindowManager)
    private FrameLayout   bubbleCircle;     // inner circle FrameLayout (holds background + tint)
    private TextView      bubbleLabel;
    private ImageView     logoView;
    private View          blinkView;
    private final android.os.Handler blinkHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final java.util.Random   blinkRandom  = new java.util.Random();
    private TextView      nameLabel;        // Feature 7 — name shown under bubble icon (hidden)
    private TextView      crownLabel;       // Feature 8 stage 6 — crown decoration
    private boolean       companionOpen       = false;
    private boolean       screenCaptureActive = false;

    // ── Evolution stage parameters (set by applyEvolutionStage) ──────────────
    private float   breatheMax       = 1.08f;    // peak scale during breathing
    private long    breatheDuration  = 2800;     // ms per breathing cycle
    private int     strokeWidthDp    = 2;        // bubble border stroke
    private String  strokeColorIdle  = "#e0e0e0"; // idle stroke colour

    // ── Proactive engine ───────────────────────────────────────────────────────
    private long lastInteractionTime  = System.currentTimeMillis();
    private long lastProactiveTrigger = 0L;
    private final android.os.Handler proactiveHandler =
            new android.os.Handler(android.os.Looper.getMainLooper());

    // ── Speaking state ─────────────────────────────────────────────────────────
    private boolean      isSpeaking      = false;
    private AnimatorSet  lipSyncAnimator;

    // ── Speech bubble overlay ──────────────────────────────────────────────────
    private TextView                  speechBubbleView;
    private WindowManager.LayoutParams speechBubbleParams;
    private boolean                   speechBubbleAdded = false;
    private WindowManager.LayoutParams bubbleWinParams;

    // ── Animation state ────────────────────────────────────────────────────────
    private AnimatorSet breathingAnimator;   // idle breathing pulse (anim 1)
    private AnimatorSet entryAnimator;       // entry pop-in (anim 2) — stored so onDestroy can cancel it
    private AnimatorSet exitAnimator;        // exit shrink (anim 2b) — guard against double-dismiss
    private ObjectAnimator rippleAnimator;   // tap ripple (anim 3) — stored to cancel on double-tap
    private AnimatorSet glowAnimator;        // thinking glow (anim 4)
    private boolean     isThinking          = false;
    private int         thinkingRefCount    = 0; // counts in-flight /api/companion fetches
    private boolean     isDestroyed         = false; // set in onDestroy; guards post-destroy callbacks

    // ── Broadcast receivers ───────────────────────────────────────────────────

    private final BroadcastReceiver screenCaptureReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (ScreenCaptureService.ACTION_CAPTURE_STARTED.equals(intent.getAction())) {
                screenCaptureActive = true;
                updateBubbleStroke();
            } else if (ScreenCaptureService.ACTION_CAPTURE_STOPPED.equals(intent.getAction())) {
                screenCaptureActive = false;
                updateBubbleStroke();
            }
        }
    };

    private final BroadcastReceiver companionClosedReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (CompanionActivity.ACTION_COMPANION_CLOSED.equals(intent.getAction())) {
                companionOpen = false;
            }
        }
    };

    private final BroadcastReceiver thinkingReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (ACTION_BUBBLE_THINKING.equals(intent.getAction())) {
                boolean active = intent.getBooleanExtra(EXTRA_THINKING_ACTIVE, false);
                if (active) {
                    // Increment ref count: each in-flight fetch votes to keep thinking active.
                    thinkingRefCount++;
                    startThinking();
                } else {
                    // Decrement ref count: only stop thinking when all fetches have resolved.
                    thinkingRefCount = Math.max(0, thinkingRefCount - 1);
                    if (thinkingRefCount == 0) {
                        stopThinking();
                    }
                }
            }
        }
    };

    // ── Feature 7: name update receiver ──────────────────────────────────────
    private final BroadcastReceiver nameUpdateReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (ACTION_UPDATE_NAME.equals(intent.getAction())) {
                String name = intent.getStringExtra(EXTRA_NAME);
                if (name != null && !name.isEmpty()) {
                    companionName = name;
                    if (nameLabel != null) {
                        nameLabel.setText(companionName);
                    }
                }
            }
        }
    };

    // ── Speaking receiver ─────────────────────────────────────────────────────
    private final BroadcastReceiver speakingReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (ACTION_BUBBLE_SPEAKING.equals(intent.getAction())) {
                boolean active = intent.getBooleanExtra(EXTRA_SPEAKING_ACTIVE, false);
                String text    = intent.getStringExtra(EXTRA_SPEAKING_TEXT);
                if (active) startSpeakingState(text);
                else        stopSpeakingState();
            }
        }
    };

    // ── Proactive runnable ────────────────────────────────────────────────────
    private final Runnable proactiveRunnable = new Runnable() {
        @Override
        public void run() {
            if (!isDestroyed) {
                checkProactiveTrigger();
                proactiveHandler.postDelayed(this, PROACTIVE_INTERVAL_MS);
            }
        }
    };

    // ── Service lifecycle ──────────────────────────────────────────────────────

    @Override
    public void onCreate() {
        super.onCreate();
        windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, buildNotification());

        // ── Feature 8: record first launch, compute days active ───────────────
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        long firstLaunch = prefs.getLong(KEY_FIRST_LAUNCH, 0L);
        if (firstLaunch == 0L) {
            firstLaunch = System.currentTimeMillis();
            prefs.edit().putLong(KEY_FIRST_LAUNCH, firstLaunch).apply();
        }
        daysActive = (System.currentTimeMillis() - firstLaunch) / 86400000L;

        IntentFilter closedFilter = new IntentFilter(CompanionActivity.ACTION_COMPANION_CLOSED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(companionClosedReceiver, closedFilter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(companionClosedReceiver, closedFilter);
        }

        IntentFilter captureFilter = new IntentFilter();
        captureFilter.addAction(ScreenCaptureService.ACTION_CAPTURE_STARTED);
        captureFilter.addAction(ScreenCaptureService.ACTION_CAPTURE_STOPPED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(screenCaptureReceiver, captureFilter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(screenCaptureReceiver, captureFilter);
        }

        IntentFilter thinkingFilter = new IntentFilter(ACTION_BUBBLE_THINKING);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(thinkingReceiver, thinkingFilter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(thinkingReceiver, thinkingFilter);
        }

        // ── Feature 7: register name update receiver ──────────────────────────
        IntentFilter nameFilter = new IntentFilter(ACTION_UPDATE_NAME);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(nameUpdateReceiver, nameFilter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(nameUpdateReceiver, nameFilter);
        }

        IntentFilter speakingFilter = new IntentFilter(ACTION_BUBBLE_SPEAKING);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(speakingReceiver, speakingFilter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(speakingReceiver, speakingFilter);
        }

        proactiveHandler.postDelayed(proactiveRunnable, PROACTIVE_INTERVAL_MS);

        addBubble();
        // ── Feature 8: apply evolution BEFORE animations start ────────────────
        applyEvolutionStage(daysActive);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        isDestroyed = true;
        thinkingRefCount = 0;

        // Cancel all animators to prevent leaks
        cancelEntry();
        cancelBreathing();
        cancelGlow();
        cancelRipple();
        cancelExit();

        try { unregisterReceiver(companionClosedReceiver); } catch (Exception ignored) {}
        try { unregisterReceiver(screenCaptureReceiver);   } catch (Exception ignored) {}
        try { unregisterReceiver(thinkingReceiver);        } catch (Exception ignored) {}
        try { unregisterReceiver(nameUpdateReceiver);      } catch (Exception ignored) {}
        try { unregisterReceiver(speakingReceiver);        } catch (Exception ignored) {}
        proactiveHandler.removeCallbacks(proactiveRunnable);
        blinkHandler.removeCallbacksAndMessages(null);
        cancelLipSync();
        hideSpeechBubble();
        isSpeaking = false;

        if (bubbleView != null) {
            try { windowManager.removeView(bubbleView); } catch (Exception ignored) {}
            bubbleView = null; // prevent post-destroy callbacks from animating a detached view
        }
    }

    // ── Notification ──────────────────────────────────────────────────────────

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Based", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Based companion is running");
            channel.setSound(null, null);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification() {
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }
        return builder
                .setContentTitle("Based")
                .setContentText("Based companion is running")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setOngoing(true)
                .build();
    }

    // ── Floating bubble ────────────────────────────────────────────────────────

    private void addBubble() {
        int sizePx = dpToPx(BUBBLE_SIZE_DP);
        int totalHeightPx = sizePx;

        // ── Root container: bubble circle + name label + optional decorations ─
        FrameLayout container = new FrameLayout(this);

        // ── Bubble circle ─────────────────────────────────────────────────────
        bubbleCircle = new FrameLayout(this);

        android.graphics.drawable.GradientDrawable circle =
                new android.graphics.drawable.GradientDrawable();
        circle.setShape(android.graphics.drawable.GradientDrawable.OVAL);
        circle.setColor(Color.TRANSPARENT); // no dark fill — PNG provides its own bg
        circle.setStroke(0, Color.TRANSPARENT); // no border ring
        bubbleCircle.setBackground(circle);
        // Clip the logo PNG to a circle so no square corners bleed out
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            bubbleCircle.setOutlineProvider(android.view.ViewOutlineProvider.BACKGROUND);
            bubbleCircle.setClipToOutline(true);
        }

        // Strip dark pixels from PNG so only the gold hexagon outline + eye float transparently
        logoView = new ImageView(this);
        android.graphics.Bitmap rawLogo = android.graphics.BitmapFactory.decodeResource(
                getResources(), R.drawable.based_logo);
        logoView.setImageBitmap(makeExteriorTransparent(rawLogo, 80));
        rawLogo.recycle();
        logoView.setScaleType(ImageView.ScaleType.FIT_CENTER);
        bubbleCircle.addView(logoView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        // Blink eyelid — dark strip matching hexagon interior, drops over ONLY the eye
        // Eye sits at ~52% from top of the 56dp bubble; strip expands downward from eye top
        blinkView = new View(this);
        blinkView.setBackgroundColor(Color.parseColor("#09080e")); // matches hexagon interior dark — covers the gold eye
        blinkView.setScaleY(0f);
        blinkView.setPivotY(0f); // expand downward from the top edge (like an eyelid dropping)
        FrameLayout.LayoutParams blinkParams = new FrameLayout.LayoutParams(dpToPx(18), dpToPx(8));
        blinkParams.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        blinkParams.topMargin = (int) (sizePx * 0.46f); // top of eye area
        bubbleCircle.addView(blinkView, blinkParams);

        scheduleBlink();

        // bubbleLabel is kept for potential future use but hidden
        bubbleLabel = new TextView(this);
        bubbleLabel.setText("✕");
        bubbleLabel.setTextColor(Color.parseColor("#e0e0e0"));
        bubbleLabel.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 20);
        bubbleLabel.setTypeface(null, Typeface.BOLD);
        bubbleLabel.setGravity(Gravity.CENTER);
        bubbleLabel.setVisibility(View.GONE);
        bubbleCircle.addView(bubbleLabel, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        FrameLayout.LayoutParams bubbleParams = new FrameLayout.LayoutParams(sizePx, sizePx);
        bubbleParams.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        container.addView(bubbleCircle, bubbleParams);

        // Feature 7: nameLabel kept as a field (referenced elsewhere) but not shown
        nameLabel = new TextView(this);

        // ── Feature 8 stage 6: crown label (hidden until stage 6) ────────────
        crownLabel = new TextView(this);
        crownLabel.setText("✶"); // ✶ six-pointed star
        crownLabel.setTextColor(Color.parseColor("#ffd700"));
        crownLabel.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 9);
        crownLabel.setGravity(Gravity.CENTER);
        crownLabel.setAlpha(0f); // hidden until stage 6
        FrameLayout.LayoutParams crownParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT);
        crownParams.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        crownParams.topMargin = 0; // sits at top edge of window (negative margin would clip outside window bounds)
        container.addView(crownLabel, crownParams);

        int windowWidthPx = sizePx;
        final WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                windowWidthPx, totalHeightPx,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = dpToPx(16);
        params.y = dpToPx(200);
        bubbleWinParams = params;

        container.setOnTouchListener(new View.OnTouchListener() {
            private float initialTouchX, initialTouchY;
            private int   initialParamsX, initialParamsY;
            private long  touchDownTime;
            private float totalMoveX, totalMoveY;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        initialTouchX = event.getRawX();
                        initialTouchY = event.getRawY();
                        initialParamsX = params.x;
                        initialParamsY = params.y;
                        touchDownTime = System.currentTimeMillis();
                        totalMoveX = 0;
                        totalMoveY = 0;
                        return true;

                    case MotionEvent.ACTION_MOVE:
                        float dx = event.getRawX() - initialTouchX;
                        float dy = event.getRawY() - initialTouchY;
                        totalMoveX = Math.abs(dx);
                        totalMoveY = Math.abs(dy);
                        params.x = initialParamsX + (int) dx;
                        params.y = initialParamsY + (int) dy;
                        windowManager.updateViewLayout(bubbleView, params);
                        if (speechBubbleAdded && speechBubbleView != null && speechBubbleParams != null) {
                            int bw = dpToPx(180);
                            speechBubbleParams.x = params.x - (bw - sizePx) / 2;
                            speechBubbleParams.y = Math.max(0, params.y - dpToPx(90));
                            try { windowManager.updateViewLayout(speechBubbleView, speechBubbleParams); }
                            catch (Exception ignored) {}
                        }
                        return true;

                    case MotionEvent.ACTION_UP:
                        long duration = System.currentTimeMillis() - touchDownTime;
                        if (duration < 200 && totalMoveX < dpToPx(10) && totalMoveY < dpToPx(10)) {
                            if (!companionOpen) {
                                // Anim 3: tap ripple — run concurrently, don't delay open
                                playTapRipple();
                                openCompanion();
                            } else {
                                closeCompanion();
                            }
                        }
                        return true;
                }
                return false;
            }
        });

        // bubbleView is the outer container (includes name label space)
        bubbleView = container;

        // ── Anim 2 (entry): play immediately after addView ──────────────────
        // Set initial state: invisible + scaled to 0 before adding to window
        container.setAlpha(0f);
        container.setScaleX(0f);
        container.setScaleY(0f);

        windowManager.addView(bubbleView, params);

        // Entry animation starts AFTER applyEvolutionStage() (called from onCreate after addBubble)
        // so we defer it via a post. applyEvolutionStage sets stage params synchronously.
        bubbleView.post(() -> {
            if (!isDestroyed && bubbleView != null) {
                playEntryAnimation();
            }
        });
    }

    // ── Feature 8: apply visual evolution based on days active ───────────────

    /**
     * Sets visual parameters for the appropriate evolution stage.
     * MUST be called after addBubble() and before playEntryAnimation().
     * Does not start any animations — only configures the visual state.
     */
    private void applyEvolutionStage(long days) {
        if (bubbleView == null) return;

        if (days >= 100) {
            // Stage 6 — Veteran
            breatheMax      = 1.08f;
            breatheDuration = 3500;
            strokeWidthDp   = 3;
            strokeColorIdle = "#ffd700";
            if (crownLabel != null) crownLabel.setAlpha(1f);
        } else if (days >= 60) {
            // Stage 5
            breatheMax      = 1.08f;
            breatheDuration = 2800;
            strokeWidthDp   = 3;
            strokeColorIdle = "#f5c842";
        } else if (days >= 30) {
            // Stage 4
            breatheMax      = 1.08f;
            breatheDuration = 2800;
            strokeWidthDp   = 3;
            strokeColorIdle = "#ffd700";
        } else if (days >= 14) {
            // Stage 3
            breatheMax      = 1.08f;
            breatheDuration = 2800;
            strokeWidthDp   = 3;
            strokeColorIdle = "#ffd700";
        } else if (days >= 7) {
            // Stage 2
            breatheMax      = 1.10f;
            breatheDuration = 2800;
            strokeWidthDp   = 2;
            strokeColorIdle = "#f5c842";
        } else {
            // Stage 1 — default
            breatheMax      = 1.08f;
            breatheDuration = 2800;
            strokeWidthDp   = 2;
            strokeColorIdle = "#e0e0e0";
        }

        updateBubbleStroke();
    }

    // ── Companion open/close ───────────────────────────────────────────────────

    private void openCompanion() {
        lastInteractionTime = System.currentTimeMillis();
        companionOpen = true;
        hideSpeechBubble();
        Intent intent = new Intent(this, CompanionActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        startActivity(intent);
    }

    private void closeCompanion() {
        lastInteractionTime = System.currentTimeMillis();
        companionOpen = false;
        Intent closeIntent = new Intent(CompanionActivity.ACTION_CLOSE_REQUEST);
        closeIntent.setPackage(getPackageName());
        sendBroadcast(closeIntent);
    }

    // ── Logo helpers ──────────────────────────────────────────────────────────

    // Flood-fills from every edge pixel outward, making exterior dark pixels transparent.
    // The gold hexagon outline acts as a wall — interior dark pixels are never reached,
    // so they keep their colour. Result: transparent outside, dark inside the hexagon.
    private android.graphics.Bitmap makeExteriorTransparent(android.graphics.Bitmap src, int threshold) {
        android.graphics.Bitmap out = src.copy(android.graphics.Bitmap.Config.ARGB_8888, true);
        int w = out.getWidth(), h = out.getHeight();
        int[] px = new int[w * h];
        out.getPixels(px, 0, w, 0, 0, w, h);

        boolean[] visited = new boolean[w * h];
        java.util.ArrayDeque<Integer> queue = new java.util.ArrayDeque<>();

        // Seed: all edge pixels that are dark are definitely exterior
        for (int x = 0; x < w; x++) {
            seedEdge(px, visited, queue, x, 0,     w, threshold);
            seedEdge(px, visited, queue, x, h - 1, w, threshold);
        }
        for (int y = 1; y < h - 1; y++) {
            seedEdge(px, visited, queue, 0,     y, w, threshold);
            seedEdge(px, visited, queue, w - 1, y, w, threshold);
        }

        // BFS: spread through connected dark pixels
        while (!queue.isEmpty()) {
            int idx = queue.poll();
            px[idx] = Color.TRANSPARENT;
            int x = idx % w, y = idx / w;
            if (x > 0)     tryEnqueue(px, visited, queue, idx - 1,     threshold);
            if (x < w - 1) tryEnqueue(px, visited, queue, idx + 1,     threshold);
            if (y > 0)     tryEnqueue(px, visited, queue, idx - w,     threshold);
            if (y < h - 1) tryEnqueue(px, visited, queue, idx + w,     threshold);
        }

        out.setPixels(px, 0, w, 0, 0, w, h);
        return out;
    }

    private void seedEdge(int[] px, boolean[] visited, java.util.ArrayDeque<Integer> q,
                          int x, int y, int w, int threshold) {
        int idx = y * w + x;
        if (!visited[idx] && isDarkPixel(px[idx], threshold)) {
            visited[idx] = true;
            q.add(idx);
        }
    }

    private void tryEnqueue(int[] px, boolean[] visited, java.util.ArrayDeque<Integer> q,
                            int idx, int threshold) {
        if (!visited[idx] && isDarkPixel(px[idx], threshold)) {
            visited[idx] = true;
            q.add(idx);
        }
    }

    private boolean isDarkPixel(int color, int threshold) {
        return Color.red(color) < threshold
                && Color.green(color) < threshold
                && Color.blue(color) < threshold;
    }

    // ── Blink animation ───────────────────────────────────────────────────────

    private void scheduleBlink() {
        blinkHandler.postDelayed(() -> {
            if (isDestroyed || blinkView == null) return;
            // Reset logoView scale in case a previous animation left it stuck
            if (logoView != null) logoView.setScaleY(1f);
            // Eyelid drops (scaleY 0→1): fast close
            ObjectAnimator close = ObjectAnimator.ofFloat(blinkView, "scaleY", 0f, 1f);
            close.setDuration(150);
            close.setInterpolator(new AccelerateInterpolator());
            // Hold fully closed
            ObjectAnimator hold = ObjectAnimator.ofFloat(blinkView, "scaleY", 1f, 1f);
            hold.setDuration(60);
            // Eyelid rises (scaleY 1→0): lazy open
            ObjectAnimator open = ObjectAnimator.ofFloat(blinkView, "scaleY", 1f, 0f);
            open.setDuration(200);
            open.setInterpolator(new android.view.animation.DecelerateInterpolator());
            AnimatorSet blink = new AnimatorSet();
            blink.playSequentially(close, hold, open);
            blink.start();
            scheduleBlink();
        }, 2500L + blinkRandom.nextInt(2000)); // random 2.5 – 4.5 s
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Animations
    // ═══════════════════════════════════════════════════════════════════════════

    // ── Anim 1: Idle breathing pulse ──────────────────────────────────────────

    private void startBreathing() {
        if (isDestroyed || bubbleView == null) return;
        cancelBreathing();

        ObjectAnimator scaleX = ObjectAnimator.ofFloat(bubbleView, "scaleX", 1f, breatheMax, 1f);
        ObjectAnimator scaleY = ObjectAnimator.ofFloat(bubbleView, "scaleY", 1f, breatheMax, 1f);

        scaleX.setDuration(breatheDuration);
        scaleY.setDuration(breatheDuration);
        scaleX.setRepeatCount(ObjectAnimator.INFINITE);
        scaleY.setRepeatCount(ObjectAnimator.INFINITE);
        scaleX.setInterpolator(new AccelerateDecelerateInterpolator());
        scaleY.setInterpolator(new AccelerateDecelerateInterpolator());

        breathingAnimator = new AnimatorSet();
        breathingAnimator.playTogether(scaleX, scaleY);
        breathingAnimator.start();
    }

    private void pauseBreathing() {
        if (breathingAnimator != null && breathingAnimator.isRunning()) {
            breathingAnimator.pause();
        }
    }

    private void resumeBreathing() {
        if (breathingAnimator != null && breathingAnimator.isPaused()) {
            breathingAnimator.resume();
        } else if (breathingAnimator == null || !breathingAnimator.isRunning()) {
            startBreathing();
        }
    }

    private void cancelBreathing() {
        if (breathingAnimator != null) {
            breathingAnimator.cancel();
            breathingAnimator = null;
        }
    }

    // ── Anim 2: Entry animation ───────────────────────────────────────────────

    private void cancelEntry() {
        if (entryAnimator != null) {
            entryAnimator.cancel();
            entryAnimator = null;
        }
    }

    private void playEntryAnimation() {
        if (bubbleView == null) return;

        // Scale with overshoot bounce: 0 → 1.1 → 1.0
        ObjectAnimator scaleX = ObjectAnimator.ofFloat(bubbleView, "scaleX", 0f, 1.1f, 1.0f);
        ObjectAnimator scaleY = ObjectAnimator.ofFloat(bubbleView, "scaleY", 0f, 1.1f, 1.0f);
        ObjectAnimator alpha  = ObjectAnimator.ofFloat(bubbleView, "alpha",  0f, 1f);

        scaleX.setDuration(320);
        scaleY.setDuration(320);
        alpha.setDuration(320);

        scaleX.setInterpolator(new OvershootInterpolator(1.5f));
        scaleY.setInterpolator(new OvershootInterpolator(1.5f));
        alpha.setInterpolator(new LinearInterpolator());

        entryAnimator = new AnimatorSet();
        entryAnimator.playTogether(scaleX, scaleY, alpha);
        entryAnimator.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(Animator animation) {
                entryAnimator = null;
                // Guard: exit may have already removed the view, or service is torn down.
                if (isDestroyed || bubbleView == null) return;
                // Once entry is done, start idle breathing (use GlobalLayoutListener to ensure
                // the view is fully laid out — remove after first callback to avoid repeat).
                final View capturedView = bubbleView;
                capturedView.getViewTreeObserver().addOnGlobalLayoutListener(
                        new ViewTreeObserver.OnGlobalLayoutListener() {
                    @Override
                    public void onGlobalLayout() {
                        // Always remove the listener first — even if we bail early — to prevent leak.
                        if (capturedView.getViewTreeObserver().isAlive()) {
                            capturedView.getViewTreeObserver().removeOnGlobalLayoutListener(this);
                        }
                        // Guard: service may have been destroyed between entry end and layout callback,
                        // or exit may have already been initiated (don't start breathing during exit).
                        if (isDestroyed || bubbleView == null || exitAnimator != null) return;
                        startBreathing();
                    }
                });
            }
        });
        entryAnimator.start();
    }

    // ── Anim 2: Exit animation ─────────────────────────────────────────────────

    private void cancelExit() {
        if (exitAnimator != null) {
            exitAnimator.cancel();
            exitAnimator = null;
        }
    }

    private void playExitAndRemove() {
        if (bubbleView == null) return;
        // Guard against double-dismiss: if exit is already in progress, ignore.
        if (exitAnimator != null && exitAnimator.isRunning()) return;

        cancelEntry();
        cancelBreathing();
        cancelGlow();
        cancelRipple();
        cancelLipSync();
        hideSpeechBubble();

        // Read actual current scale so there's no one-frame snap if an animation
        // was cancelled mid-flight (e.g. breathing at 1.07f, thinking glow at 1.12f).
        float fromScale = bubbleView.getScaleX();
        float fromAlpha = bubbleView.getAlpha();

        ObjectAnimator scaleX = ObjectAnimator.ofFloat(bubbleView, "scaleX", fromScale, 0f);
        ObjectAnimator scaleY = ObjectAnimator.ofFloat(bubbleView, "scaleY", fromScale, 0f);
        ObjectAnimator alpha  = ObjectAnimator.ofFloat(bubbleView, "alpha",  fromAlpha, 0f);

        scaleX.setDuration(200);
        scaleY.setDuration(200);
        alpha.setDuration(200);

        scaleX.setInterpolator(new AccelerateInterpolator());
        scaleY.setInterpolator(new AccelerateInterpolator());
        alpha.setInterpolator(new AccelerateInterpolator());

        exitAnimator = new AnimatorSet();
        exitAnimator.playTogether(scaleX, scaleY, alpha);
        exitAnimator.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(Animator animation) {
                exitAnimator = null;
                if (bubbleView != null) {
                    try { windowManager.removeView(bubbleView); } catch (Exception ignored) {}
                    bubbleView = null;
                }
                stopSelf();
            }
        });
        exitAnimator.start();
    }

    // ── Proactive engine ──────────────────────────────────────────────────────

    private void checkProactiveTrigger() {
        if (companionOpen) { lastInteractionTime = System.currentTimeMillis(); return; }

        android.os.PowerManager pm = (android.os.PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null && !pm.isInteractive()) return;

        long now = System.currentTimeMillis();
        long idleMs = now - lastInteractionTime;
        if (idleMs < MIN_IDLE_MS || idleMs > MAX_IDLE_MS) return;
        if (now - lastProactiveTrigger < MIN_TRIGGER_GAP_MS) return;

        java.util.Calendar cal = java.util.Calendar.getInstance(
                java.util.TimeZone.getTimeZone("Asia/Singapore"));
        int hour = cal.get(java.util.Calendar.HOUR_OF_DAY);
        if (hour < 7 || hour >= 23) return;

        lastProactiveTrigger = now;
        String context = hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";

        Intent intent = new Intent(FloatingBubbleService.this, CompanionActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        intent.putExtra("PROACTIVE_CONTEXT", context);
        startActivity(intent);
    }

    // ── Speaking state ────────────────────────────────────────────────────────

    private void startSpeakingState(String text) {
        lastInteractionTime = System.currentTimeMillis();
        if (!isSpeaking) {
            isSpeaking = true;
            // If thinking is active, clear it so lip-sync takes over
            if (isThinking) {
                cancelGlow();
                if (bubbleCircle != null) {
                    bubbleCircle.getBackground().clearColorFilter();
                    bubbleCircle.setLayerType(View.LAYER_TYPE_NONE, null);
                }
            }
            startLipSync();
        }
        if (!companionOpen && text != null && !text.isEmpty()) {
            showSpeechBubble(text);
        }
    }

    private void stopSpeakingState() {
        if (!isSpeaking) return;
        isSpeaking = false;
        cancelLipSync();
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
            if (!isSpeaking) hideSpeechBubble();
        }, 1000);
        if (!isThinking) resumeBreathing();
    }

    // ── Anim 5b: Lip-sync animation ───────────────────────────────────────────

    private void startLipSync() {
        if (isDestroyed || bubbleView == null) return;
        cancelLipSync();
        pauseBreathing();

        // Mirror Electron's lip-sync keyframes: 1→1.14→0.97→1.10→1 at 500ms
        ObjectAnimator x = ObjectAnimator.ofFloat(bubbleView, "scaleX", 1f, 1.14f, 0.97f, 1.1f, 1f);
        ObjectAnimator y = ObjectAnimator.ofFloat(bubbleView, "scaleY", 1f, 1.14f, 0.97f, 1.1f, 1f);
        x.setDuration(500);
        y.setDuration(500);
        x.setRepeatCount(ObjectAnimator.INFINITE);
        y.setRepeatCount(ObjectAnimator.INFINITE);
        x.setInterpolator(new AccelerateDecelerateInterpolator());
        y.setInterpolator(new AccelerateDecelerateInterpolator());

        lipSyncAnimator = new AnimatorSet();
        lipSyncAnimator.playTogether(x, y);
        lipSyncAnimator.start();
    }

    private void cancelLipSync() {
        if (lipSyncAnimator != null) {
            lipSyncAnimator.cancel();
            lipSyncAnimator = null;
        }
    }

    // ── Speech bubble overlay ─────────────────────────────────────────────────

    private void showSpeechBubble(String text) {
        if (bubbleWinParams == null) return;
        String display = text.length() > 120 ? text.substring(0, 117) + "…" : text;

        if (!speechBubbleAdded) {
            speechBubbleView = new TextView(this);
            speechBubbleView.setTextColor(Color.parseColor("#c9a87c"));
            speechBubbleView.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 12);
            speechBubbleView.setLineSpacing(0f, 1.4f);
            speechBubbleView.setPadding(dpToPx(10), dpToPx(8), dpToPx(10), dpToPx(8));

            android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable();
            bg.setShape(android.graphics.drawable.GradientDrawable.RECTANGLE);
            bg.setColor(Color.parseColor("#0e0c17"));
            bg.setCornerRadius(dpToPx(10));
            bg.setStroke(dpToPx(1), Color.parseColor("#c9a87c"));
            speechBubbleView.setBackground(bg);

            int sizePx = dpToPx(BUBBLE_SIZE_DP);
            int bubbleW = dpToPx(180);
            speechBubbleParams = new WindowManager.LayoutParams(
                    bubbleW,
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                    PixelFormat.TRANSLUCENT);
            speechBubbleParams.gravity = Gravity.TOP | Gravity.START;
            speechBubbleParams.x = bubbleWinParams.x - (bubbleW - sizePx) / 2;
            speechBubbleParams.y = Math.max(0, bubbleWinParams.y - dpToPx(90));

            windowManager.addView(speechBubbleView, speechBubbleParams);
            speechBubbleAdded = true;
        } else {
            speechBubbleView.setText(display);
            return;
        }

        speechBubbleView.setText(display);
    }

    private void hideSpeechBubble() {
        if (!speechBubbleAdded || speechBubbleView == null) return;
        try { windowManager.removeView(speechBubbleView); } catch (Exception ignored) {}
        speechBubbleView  = null;
        speechBubbleAdded = false;
    }

    // ── Anim 3: Tap ripple ────────────────────────────────────────────────────

    private void cancelRipple() {
        if (rippleAnimator != null) {
            rippleAnimator.cancel();
            rippleAnimator = null;
        }
    }

    private void playTapRipple() {
        if (bubbleView == null) return;

        // Cancel any in-flight ripple (double-tap) before starting a new one.
        cancelRipple();

        // Pause breathing while tap animation plays; resume after.
        // Only pause if breathing is actually running — don't disturb entry animation.
        pauseBreathing();

        // keyframes: 0ms=1.0, 80ms=0.82, 180ms=1.15, 260ms=1.0
        Keyframe kf0 = Keyframe.ofFloat(0f,              1.0f);
        Keyframe kf1 = Keyframe.ofFloat(80f  / 260f,     0.82f);
        Keyframe kf2 = Keyframe.ofFloat(180f / 260f,     1.15f);
        Keyframe kf3 = Keyframe.ofFloat(1f,              1.0f);

        PropertyValuesHolder pvhX = PropertyValuesHolder.ofKeyframe("scaleX", kf0, kf1, kf2, kf3);
        PropertyValuesHolder pvhY = PropertyValuesHolder.ofKeyframe("scaleY",
                Keyframe.ofFloat(0f,          1.0f),
                Keyframe.ofFloat(80f / 260f,  0.82f),
                Keyframe.ofFloat(180f / 260f, 1.15f),
                Keyframe.ofFloat(1f,          1.0f));

        rippleAnimator = ObjectAnimator.ofPropertyValuesHolder(bubbleView, pvhX, pvhY);
        rippleAnimator.setDuration(260);
        rippleAnimator.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(Animator animation) {
                rippleAnimator = null;
                // Only resume breathing if:
                //   • thinking is not active (thinking manages breathing itself), AND
                //   • entry animation is not still running (entry will start breathing when done).
                if (!isThinking && entryAnimator == null) {
                    resumeBreathing();
                }
            }
        });
        rippleAnimator.start();
    }

    // ── Anim 4: Active / thinking state ──────────────────────────────────────

    private void startThinking() {
        if (isDestroyed || isThinking) return;
        isThinking = true;

        pauseBreathing();
        cancelGlow();

        // Guard: view may be null if service is tearing down.
        if (bubbleView == null || bubbleCircle == null) return;

        // Thinking glow colour: stage 5+ uses deep indigo, others use violet
        int glowColor = (daysActive >= 60)
                ? Color.argb(60, 75, 0, 130)    // #4b0082 — deep indigo
                : Color.argb(60, 160, 90, 255);  // violet

        // Apply tint to the circle (which holds the background drawable)
        bubbleCircle.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        bubbleCircle.getBackground().setColorFilter(
                new PorterDuffColorFilter(glowColor, PorterDuff.Mode.SRC_ATOP));

        // Faster glow pulse: 1.0 → 1.14 → 1.0, 700ms/cycle, INFINITE
        ObjectAnimator glowX = ObjectAnimator.ofFloat(bubbleView, "scaleX", 1.0f, 1.14f, 1.0f);
        ObjectAnimator glowY = ObjectAnimator.ofFloat(bubbleView, "scaleY", 1.0f, 1.14f, 1.0f);

        glowX.setDuration(700);
        glowY.setDuration(700);
        glowX.setRepeatCount(ObjectAnimator.INFINITE);
        glowY.setRepeatCount(ObjectAnimator.INFINITE);
        glowX.setInterpolator(new AccelerateDecelerateInterpolator());
        glowY.setInterpolator(new AccelerateDecelerateInterpolator());

        glowAnimator = new AnimatorSet();
        glowAnimator.playTogether(glowX, glowY);
        glowAnimator.start();
    }

    private void stopThinking() {
        if (isDestroyed || !isThinking) return;
        isThinking = false;

        cancelGlow();

        // Remove tint and hardware layer from circle; reset container scale
        if (bubbleCircle != null) {
            bubbleCircle.getBackground().clearColorFilter();
            bubbleCircle.setLayerType(View.LAYER_TYPE_NONE, null);
        }
        if (bubbleView != null) {
            // Reset scale to 1.0 cleanly before resuming animation
            bubbleView.setScaleX(1f);
            bubbleView.setScaleY(1f);
        }

        if (isSpeaking) startLipSync(); else resumeBreathing();
    }

    private void cancelGlow() {
        if (glowAnimator != null) {
            glowAnimator.cancel();
            glowAnimator = null;
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private void updateBubbleStroke() {
        if (bubbleCircle == null) return;
        android.graphics.drawable.GradientDrawable circle =
                new android.graphics.drawable.GradientDrawable();
        circle.setShape(android.graphics.drawable.GradientDrawable.OVAL);
        circle.setColor(Color.TRANSPARENT); // no dark fill — logo PNG provides background
        circle.setStroke(0, Color.TRANSPARENT); // no border ring
        bubbleCircle.setBackground(circle);
        // Re-apply clip so the logo PNG stays clipped to the oval after background swap
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            bubbleCircle.setOutlineProvider(android.view.ViewOutlineProvider.BACKGROUND);
            bubbleCircle.setClipToOutline(true);
        }

        // Re-apply tint if currently thinking (background was just replaced)
        if (isThinking) {
            int glowColor = (daysActive >= 60)
                    ? Color.argb(60, 75, 0, 130)
                    : Color.argb(60, 160, 90, 255);
            bubbleCircle.getBackground().setColorFilter(
                    new PorterDuffColorFilter(glowColor, PorterDuff.Mode.SRC_ATOP));
        }
    }

    private int dpToPx(int dp) {
        return Math.round(dp * getResources().getDisplayMetrics().density);
    }
}
