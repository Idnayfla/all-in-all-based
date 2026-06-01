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

    // ── Feature 8: Evolution tracking ─────────────────────────────────────────
    private static final String PREFS_NAME          = "based_prefs";
    private static final String KEY_FIRST_LAUNCH    = "based_first_launch";
    private long                daysActive          = 0;

    // ── Window / view ──────────────────────────────────────────────────────────
    private WindowManager windowManager;
    private View          bubbleView;       // outer container (added to WindowManager)
    private FrameLayout   bubbleCircle;     // inner circle FrameLayout (holds background + tint)
    private TextView      bubbleLabel;
    private TextView      nameLabel;        // Feature 7 — name shown under bubble icon
    private TextView      crownLabel;       // Feature 8 stage 6 — crown decoration
    private View          outerRing;        // Feature 8 stage 2+ — outer pulsing ring
    private boolean       companionOpen       = false;
    private boolean       screenCaptureActive = false;

    // ── Evolution stage parameters (set by applyEvolutionStage) ──────────────
    private float   breatheMax       = 1.08f;    // peak scale during breathing
    private long    breatheDuration  = 2800;     // ms per breathing cycle
    private int     strokeWidthDp    = 2;        // bubble border stroke
    private String  strokeColorIdle  = "#e0e0e0"; // idle stroke colour
    private boolean outerRingVisible = false;    // whether outer ring is shown

    // ── Animation state ────────────────────────────────────────────────────────
    private AnimatorSet breathingAnimator;   // idle breathing pulse (anim 1)
    private AnimatorSet entryAnimator;       // entry pop-in (anim 2) — stored so onDestroy can cancel it
    private AnimatorSet exitAnimator;        // exit shrink (anim 2b) — guard against double-dismiss
    private ObjectAnimator rippleAnimator;   // tap ripple (anim 3) — stored to cancel on double-tap
    private AnimatorSet glowAnimator;        // thinking glow (anim 4)
    private AnimatorSet outerRingAnimator;   // outer ring pulse (anim 5) — feature 8
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
                if (bubbleLabel != null) {
                    bubbleLabel.setText("B");
                }
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
        cancelOuterRing();

        try { unregisterReceiver(companionClosedReceiver); } catch (Exception ignored) {}
        try { unregisterReceiver(screenCaptureReceiver);   } catch (Exception ignored) {}
        try { unregisterReceiver(thinkingReceiver);        } catch (Exception ignored) {}
        try { unregisterReceiver(nameUpdateReceiver);      } catch (Exception ignored) {}

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
        // Extra height to accommodate the name label below the bubble circle.
        // Name label is ~14sp tall (~20dp) + 2dp gap = 22dp extra below bubble.
        int nameLabelHeightDp = 22;
        int totalHeightPx = sizePx + dpToPx(nameLabelHeightDp);

        // ── Root container: bubble circle + name label + optional decorations ─
        FrameLayout container = new FrameLayout(this);

        // ── Feature 8 stage 2+: outer ring view (behind everything) ───────────
        outerRing = new View(this);
        android.graphics.drawable.GradientDrawable ringDrawable =
                new android.graphics.drawable.GradientDrawable();
        ringDrawable.setShape(android.graphics.drawable.GradientDrawable.OVAL);
        ringDrawable.setColor(Color.TRANSPARENT);
        ringDrawable.setStroke(dpToPx(2), Color.parseColor("#f5c842"));
        outerRing.setBackground(ringDrawable);
        outerRing.setAlpha(0f); // hidden until applyEvolutionStage shows it
        // Position: centered horizontally, vertically aligned with bubble circle
        FrameLayout.LayoutParams ringParams = new FrameLayout.LayoutParams(
                (int) (sizePx * 1.25f), (int) (sizePx * 1.25f));
        // Centre the ring on the bubble circle centre (top of container)
        int ringOffset = -(int) (sizePx * 0.125f); // (sizePx * 1.25 - sizePx) / 2 = sizePx * 0.125
        ringParams.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        ringParams.topMargin = ringOffset;
        container.addView(outerRing, ringParams);

        // ── Bubble circle ─────────────────────────────────────────────────────
        bubbleCircle = new FrameLayout(this);

        android.graphics.drawable.GradientDrawable circle =
                new android.graphics.drawable.GradientDrawable();
        circle.setShape(android.graphics.drawable.GradientDrawable.OVAL);
        circle.setColor(Color.parseColor("#0a0a0f"));
        circle.setStroke(dpToPx(strokeWidthDp), Color.parseColor(strokeColorIdle));
        bubbleCircle.setBackground(circle);

        bubbleLabel = new TextView(this);
        bubbleLabel.setText("B");
        bubbleLabel.setTextColor(Color.parseColor("#e0e0e0"));
        bubbleLabel.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 20);
        bubbleLabel.setTypeface(null, Typeface.BOLD);
        bubbleLabel.setGravity(Gravity.CENTER);
        bubbleCircle.addView(bubbleLabel, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        FrameLayout.LayoutParams bubbleParams = new FrameLayout.LayoutParams(sizePx, sizePx);
        bubbleParams.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        container.addView(bubbleCircle, bubbleParams);

        // ── Feature 7: companion name label ───────────────────────────────────
        nameLabel = new TextView(this);
        nameLabel.setText(companionName);
        nameLabel.setTextColor(Color.WHITE);
        nameLabel.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 9);
        nameLabel.setGravity(Gravity.CENTER);
        nameLabel.setSingleLine(true);
        nameLabel.setEllipsize(android.text.TextUtils.TruncateAt.END);
        nameLabel.setMaxWidth(sizePx);
        // Text shadow for readability over any background: offsetX, offsetY, radius, colour
        nameLabel.setShadowLayer(2f, 0f, 1f, Color.argb(180, 0, 0, 0));

        FrameLayout.LayoutParams nameLabelParams = new FrameLayout.LayoutParams(
                sizePx, FrameLayout.LayoutParams.WRAP_CONTENT);
        nameLabelParams.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        nameLabelParams.bottomMargin = 0;
        container.addView(nameLabel, nameLabelParams);

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

        // Window width must accommodate the outer ring (sizePx * 1.25) so it is not clipped.
        int windowWidthPx = (int) (sizePx * 1.25f);
        final WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                windowWidthPx, totalHeightPx,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = dpToPx(16);
        params.y = dpToPx(200);

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
                        return true;

                    case MotionEvent.ACTION_UP:
                        long duration = System.currentTimeMillis() - touchDownTime;
                        if (duration < 200 && totalMoveX < 10 && totalMoveY < 10) {
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
            outerRingVisible = true;
            // Show crown
            if (crownLabel != null) crownLabel.setAlpha(1f);
            // Ring: always visible, full amber glow
            applyOuterRingAlpha(0.55f);
        } else if (days >= 60) {
            // Stage 5
            breatheMax      = 1.08f;
            breatheDuration = 2800;
            strokeWidthDp   = 3;
            strokeColorIdle = "#f5c842";
            outerRingVisible = true;
            applyOuterRingAlpha(0.30f);
        } else if (days >= 30) {
            // Stage 4
            breatheMax      = 1.08f;
            breatheDuration = 2800;
            strokeWidthDp   = 3;
            strokeColorIdle = "#ffd700";
            outerRingVisible = true;
            applyOuterRingAlpha(0.25f);
        } else if (days >= 14) {
            // Stage 3
            breatheMax      = 1.08f;
            breatheDuration = 2800;
            strokeWidthDp   = 3;
            strokeColorIdle = "#ffd700";
            outerRingVisible = true;
            applyOuterRingAlpha(0.20f);
        } else if (days >= 7) {
            // Stage 2
            breatheMax      = 1.10f;
            breatheDuration = 2800;
            strokeWidthDp   = 2;
            strokeColorIdle = "#f5c842";
            outerRingVisible = true;
            applyOuterRingAlpha(0.10f);
        } else {
            // Stage 1 — default
            breatheMax      = 1.08f;
            breatheDuration = 2800;
            strokeWidthDp   = 2;
            strokeColorIdle = "#e0e0e0";
            outerRingVisible = false;
            applyOuterRingAlpha(0f);
        }

        // Rebuild bubble background with correct stroke from stage
        updateBubbleStroke();

        // Start outer ring pulse animation for stages that need it
        if (outerRingVisible && outerRing != null) {
            startOuterRingPulse(days);
        }
    }

    private void applyOuterRingAlpha(float alpha) {
        if (outerRing != null) outerRing.setAlpha(alpha);
    }

    // ── Outer ring pulse animation ─────────────────────────────────────────────

    private void startOuterRingPulse(long days) {
        if (outerRing == null || !outerRingVisible) return;
        cancelOuterRing();

        // Stage 5+: faster ring at 1400ms; others at 2800ms (opposite phase to breathing)
        long ringDuration = (days >= 60) ? 1400 : 2800;

        // Opposite phase: when bubble inhales (1.0→breatheMax), ring exhales (1.0→0.85)
        ObjectAnimator ringScaleX = ObjectAnimator.ofFloat(outerRing, "scaleX", 1.0f, 0.85f, 1.0f);
        ObjectAnimator ringScaleY = ObjectAnimator.ofFloat(outerRing, "scaleY", 1.0f, 0.85f, 1.0f);

        ringScaleX.setDuration(ringDuration);
        ringScaleY.setDuration(ringDuration);
        ringScaleX.setRepeatCount(ObjectAnimator.INFINITE);
        ringScaleY.setRepeatCount(ObjectAnimator.INFINITE);
        ringScaleX.setInterpolator(new AccelerateDecelerateInterpolator());
        ringScaleY.setInterpolator(new AccelerateDecelerateInterpolator());

        outerRingAnimator = new AnimatorSet();
        outerRingAnimator.playTogether(ringScaleX, ringScaleY);
        outerRingAnimator.start();
    }

    private void cancelOuterRing() {
        if (outerRingAnimator != null) {
            outerRingAnimator.cancel();
            outerRingAnimator = null;
        }
    }

    // ── Companion open/close ───────────────────────────────────────────────────

    private void openCompanion() {
        companionOpen = true;
        bubbleLabel.setText("✕");
        Intent intent = new Intent(this, CompanionActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        startActivity(intent);
    }

    private void closeCompanion() {
        companionOpen = false;
        bubbleLabel.setText("B");
        Intent closeIntent = new Intent(CompanionActivity.ACTION_CLOSE_REQUEST);
        closeIntent.setPackage(getPackageName());
        sendBroadcast(closeIntent);
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
        cancelOuterRing();

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
            // Reset scale to 1.0 cleanly before resuming breathing
            bubbleView.setScaleX(1f);
            bubbleView.setScaleY(1f);
        }

        resumeBreathing();
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
        circle.setColor(Color.parseColor("#0a0a0f"));
        // Screen-capture active overrides stage idle stroke with amber signal.
        String strokeColor = screenCaptureActive ? "#f59e0b" : strokeColorIdle;
        circle.setStroke(dpToPx(strokeWidthDp), Color.parseColor(strokeColor));
        bubbleCircle.setBackground(circle);

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
