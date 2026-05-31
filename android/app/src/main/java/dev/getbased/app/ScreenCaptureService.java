package dev.getbased.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

public class ScreenCaptureService extends Service {

    static final String ACTION_START           = "dev.getbased.app.SCREEN_CAPTURE_START";
    static final String ACTION_STOP            = "dev.getbased.app.SCREEN_CAPTURE_STOP";
    static final String ACTION_CAPTURE_STARTED = "dev.getbased.app.SCREEN_CAPTURE_STARTED";
    static final String ACTION_CAPTURE_STOPPED = "dev.getbased.app.SCREEN_CAPTURE_STOPPED";

    static final String EXTRA_RESULT_CODE = "result_code";
    static final String EXTRA_RESULT_DATA = "result_data";

    private static final String CHANNEL_ID         = "based_screen_capture";
    private static final int    NOTIFICATION_ID     = 1002;
    private static final int    CAPTURE_INTERVAL_MS = 2000;
    private static final int    MAX_WIDTH           = 1280;
    private static final int    JPEG_QUALITY        = 30;

    /** Registered by CompanionActivity to receive frames in-process without Intent overhead. */
    public interface FrameCallback {
        void onFrame(String base64Jpeg);
    }
    public static volatile FrameCallback frameCallback = null;

    private MediaProjection mediaProjection;
    private VirtualDisplay  virtualDisplay;
    private ImageReader     imageReader;
    private Handler         captureHandler;
    private HandlerThread   handlerThread;
    private boolean         capturing      = false;
    private int             captureWidth;
    private int             captureHeight;

    private final Runnable captureRunnable = new Runnable() {
        @Override
        public void run() {
            if (!capturing) return;
            grabFrame();
            captureHandler.postDelayed(this, CAPTURE_INTERVAL_MS);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();

        DisplayMetrics metrics = new DisplayMetrics();
        ((WindowManager) getSystemService(WINDOW_SERVICE)).getDefaultDisplay().getMetrics(metrics);
        captureWidth  = Math.min(metrics.widthPixels, MAX_WIDTH);
        captureHeight = (int) (metrics.heightPixels * ((float) captureWidth / metrics.widthPixels));

        handlerThread = new HandlerThread("ScreenCapture");
        handlerThread.start();
        captureHandler = new Handler(handlerThread.getLooper());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;

        if (ACTION_STOP.equals(intent.getAction())) {
            stopCapture();
            stopSelf();
            return START_NOT_STICKY;
        }

        if (ACTION_START.equals(intent.getAction())) {
            int    resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
            Intent resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, buildNotification(),
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            } else {
                startForeground(NOTIFICATION_ID, buildNotification());
            }

            MediaProjectionManager mpm =
                    (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
            mediaProjection = mpm.getMediaProjection(resultCode, resultData);
            if (mediaProjection == null) {
                stopSelf();
                return START_NOT_STICKY;
            }

            mediaProjection.registerCallback(new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    stopCapture();
                    sendBroadcast(
                            new Intent(ACTION_CAPTURE_STOPPED).setPackage(getPackageName()));
                }
            }, captureHandler);

            imageReader = ImageReader.newInstance(
                    captureWidth, captureHeight, PixelFormat.RGBA_8888, 2);

            virtualDisplay = mediaProjection.createVirtualDisplay(
                    "BasedCapture",
                    captureWidth, captureHeight,
                    getResources().getDisplayMetrics().densityDpi,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                    imageReader.getSurface(), null, captureHandler);

            capturing = true;
            captureHandler.postDelayed(captureRunnable, CAPTURE_INTERVAL_MS);
        }

        return START_NOT_STICKY;
    }

    private void grabFrame() {
        if (imageReader == null) return;
        Image image = null;
        try {
            image = imageReader.acquireLatestImage();
            if (image == null) return;

            Image.Plane[] planes   = image.getPlanes();
            ByteBuffer    buffer   = planes[0].getBuffer();
            int           pxStride = planes[0].getPixelStride();
            int           rowStride= planes[0].getRowStride();
            int           padding  = rowStride - pxStride * image.getWidth();

            Bitmap full = Bitmap.createBitmap(
                    image.getWidth() + padding / pxStride,
                    image.getHeight(),
                    Bitmap.Config.ARGB_8888);
            full.copyPixelsFromBuffer(buffer);

            Bitmap cropped = Bitmap.createBitmap(full, 0, 0, image.getWidth(), image.getHeight());
            full.recycle();

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            cropped.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, baos);
            cropped.recycle();

            String base64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
            FrameCallback cb = frameCallback;
            if (cb != null) cb.onFrame(base64);

        } catch (Exception ignored) {
        } finally {
            if (image != null) image.close();
        }
    }

    private void stopCapture() {
        capturing = false;
        if (captureHandler != null) captureHandler.removeCallbacks(captureRunnable);
        if (virtualDisplay  != null) { virtualDisplay.release();  virtualDisplay  = null; }
        if (imageReader     != null) { imageReader.close();        imageReader     = null; }
        if (mediaProjection != null) { mediaProjection.stop();     mediaProjection = null; }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        stopCapture();
        frameCallback = null;
        if (handlerThread != null) handlerThread.quitSafely();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "Screen Capture", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Based is viewing your screen");
            ch.setSound(null, null);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private Notification buildNotification() {
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            b = new Notification.Builder(this, CHANNEL_ID);
        } else {
            b = new Notification.Builder(this);
        }
        return b.setContentTitle("Based is viewing your screen")
                .setContentText("Tap stop in Based to end screen sharing")
                .setSmallIcon(android.R.drawable.ic_menu_camera)
                .setOngoing(true)
                .build();
    }
}
