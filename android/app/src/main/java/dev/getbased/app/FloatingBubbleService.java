package dev.getbased.app;

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
import android.graphics.Typeface;
import android.os.Build;
import android.os.IBinder;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;

public class FloatingBubbleService extends Service {

    private static final String CHANNEL_ID = "based_bubble";
    private static final int BUBBLE_SIZE_DP = 56;
    private static final int NOTIFICATION_ID = 1001;

    private WindowManager windowManager;
    private View bubbleView;
    private TextView bubbleLabel;
    private boolean companionOpen      = false;
    private boolean screenCaptureActive = false;

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

    @Override
    public void onCreate() {
        super.onCreate();
        windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, buildNotification());

        IntentFilter filter = new IntentFilter(CompanionActivity.ACTION_COMPANION_CLOSED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(companionClosedReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(companionClosedReceiver, filter);
        }

        IntentFilter captureFilter = new IntentFilter();
        captureFilter.addAction(ScreenCaptureService.ACTION_CAPTURE_STARTED);
        captureFilter.addAction(ScreenCaptureService.ACTION_CAPTURE_STOPPED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(screenCaptureReceiver, captureFilter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(screenCaptureReceiver, captureFilter);
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
        try { unregisterReceiver(companionClosedReceiver); } catch (Exception ignored) {}
        try { unregisterReceiver(screenCaptureReceiver); } catch (Exception ignored) {}
        if (bubbleView != null) {
            try { windowManager.removeView(bubbleView); } catch (Exception ignored) {}
        }
    }

    // -----------------------------------------------------------------------
    // Notification
    // -----------------------------------------------------------------------

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

    // -----------------------------------------------------------------------
    // Floating bubble
    // -----------------------------------------------------------------------

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
            private int initialParamsX, initialParamsY;
            private long touchDownTime;
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
        windowManager.addView(bubbleView, params);
    }

    // -----------------------------------------------------------------------
    // Companion — launches CompanionActivity as a transparent bottom sheet
    // -----------------------------------------------------------------------

    private void openCompanion() {
        companionOpen = true;
        bubbleLabel.setText("✕");
        Intent intent = new Intent(this, CompanionActivity.class);
        // REORDER_TO_FRONT brings the existing CompanionActivity task to front if it
        // already exists; NEW_TASK is required when starting from a Service context.
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        startActivity(intent);
    }

    private void closeCompanion() {
        // Tell CompanionActivity to finish itself cleanly.
        // CompanionActivity.finish() will broadcast ACTION_COMPANION_CLOSED back to us,
        // which also resets companionOpen — but we reset here too so the bubble label
        // updates immediately on tap without waiting for the broadcast round-trip.
        companionOpen = false;
        bubbleLabel.setText("B");
        Intent closeIntent = new Intent(CompanionActivity.ACTION_CLOSE_REQUEST);
        closeIntent.setPackage(getPackageName());
        sendBroadcast(closeIntent);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

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
    }

    private int dpToPx(int dp) {
        return Math.round(dp * getResources().getDisplayMetrics().density);
    }
}
