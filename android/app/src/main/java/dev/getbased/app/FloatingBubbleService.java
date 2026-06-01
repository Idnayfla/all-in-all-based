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

    // ── Window / view ──────────────────────────────────────────────────────────
    private WindowManager windowManager;
    private View          bubbleView;
    private TextView      bubbleLabel;
    private boolean       companionOpen       = false;
    private boolean       screenCaptureActive = false;

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

    // ── Service lifecycle ──────────────────────────────────────────────────────

    @Override
    public void onCreate() {
        super.onCreate();
        windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, buildNotification());

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

        addBubble();
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

        FrameLayout bubble = new FrameLayout(this);

        android.graphics.drawable.GradientDrawable circle =
                new android.graphics.drawable.GradientDrawable();
        circle.setShape(android.graphics.drawable.GradientDrawable.OVAL);
        circle.setColor(Color.parseColor("#0a0a0f"));
        circle.setStroke(dpToPx(2), Color.parseColor("#e0e0e0"));
        bubble.setBackground(circle);

        bubbleLabel = new TextView(this);
        bubbleLabel.setText("B");
        bubbleLabel.setTextColor(Color.parseColor("#e0e0e0"));
        bubbleLabel.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 20);
        bubbleLabel.setTypeface(null, Typeface.BOLD);
        bubbleLabel.setGravity(Gravity.CENTER);
        bubble.addView(bubbleLabel, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        final WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                sizePx, sizePx,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = dpToPx(16);
        params.y = dpToPx(200);

        bubble.setOnTouchListener(new View.OnTouchListener() {
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

        bubbleView = bubble;

        // ── Anim 2 (entry): play immediately after addView ──────────────────
        // Set initial state: invisible + scaled to 0 before adding to window
        bubble.setAlpha(0f);
        bubble.setScaleX(0f);
        bubble.setScaleY(0f);

        windowManager.addView(bubbleView, params);

        playEntryAnimation();
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

        ObjectAnimator scaleX = ObjectAnimator.ofFloat(bubbleView, "scaleX", 1f, 1.08f, 1f);
        ObjectAnimator scaleY = ObjectAnimator.ofFloat(bubbleView, "scaleY", 1f, 1.08f, 1f);

        scaleX.setDuration(2800);
        scaleY.setDuration(2800);
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
        if (bubbleView == null) return;

        // Apply violet tint to signal "thinking"
        bubbleView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        bubbleView.getBackground().setColorFilter(
                new PorterDuffColorFilter(
                        Color.argb(60, 160, 90, 255),
                        PorterDuff.Mode.SRC_ATOP));

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

        // Remove tint and hardware layer
        if (bubbleView != null) {
            bubbleView.getBackground().clearColorFilter();
            bubbleView.setLayerType(View.LAYER_TYPE_NONE, null);
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
        if (bubbleView == null) return;
        android.graphics.drawable.GradientDrawable circle =
                new android.graphics.drawable.GradientDrawable();
        circle.setShape(android.graphics.drawable.GradientDrawable.OVAL);
        circle.setColor(Color.parseColor("#0a0a0f"));
        // Amber stroke signals the AI is watching; white is the idle state.
        String strokeColor = screenCaptureActive ? "#f59e0b" : "#e0e0e0";
        circle.setStroke(dpToPx(2), Color.parseColor(strokeColor));
        bubbleView.setBackground(circle);

        // Re-apply tint if currently thinking (background was just replaced)
        if (isThinking) {
            bubbleView.getBackground().setColorFilter(
                    new PorterDuffColorFilter(
                            Color.argb(60, 160, 90, 255),
                            PorterDuff.Mode.SRC_ATOP));
        }
    }

    private int dpToPx(int dp) {
        return Math.round(dp * getResources().getDisplayMetrics().density);
    }
}
