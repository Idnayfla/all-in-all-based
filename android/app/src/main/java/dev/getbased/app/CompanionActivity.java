package dev.getbased.app;

import android.Manifest;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.ImageFormat;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Base64;
import android.view.Gravity;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;

import java.io.ByteArrayOutputStream;
import java.lang.ref.WeakReference;
import java.nio.ByteBuffer;
import java.util.Arrays;

public class CompanionActivity extends AppCompatActivity {

    static final String ACTION_COMPANION_CLOSED = "dev.getbased.app.COMPANION_CLOSED";
    static final String ACTION_CLOSE_REQUEST    = "dev.getbased.app.COMPANION_CLOSE_REQUEST";

    private static final String COMPANION_URL            = "https://getbased.dev/companion";
    private static final int    REQUEST_MEDIA_PROJECTION = 1002;

    private WebView webView;
    private FrameLayout.LayoutParams panelParams;

    // ── Camera2 fields — front (face) ─────────────────────────────────────────
    private CameraDevice         cameraDevice;
    private CameraCaptureSession captureSession;
    private ImageReader          cameraImageReader;
    private Handler              cameraHandler;
    private HandlerThread        cameraThread;
    private volatile boolean     cameraRunning = false;

    // ── Camera2 fields — back (photo) ─────────────────────────────────────────
    private CameraDevice         photoCameraDevice;
    private CameraCaptureSession photoCaptureSession;
    private ImageReader          photoImageReader;
    private Handler              photoHandler;
    private HandlerThread        photoThread;
    private volatile boolean     photoCapturing = false;

    private final Runnable cameraFrameRunnable = new Runnable() {
        @Override
        public void run() {
            if (!cameraRunning) return;
            grabCameraFrame();
            if (cameraRunning && cameraHandler != null) {
                cameraHandler.postDelayed(this, 1000); // ~1 fps
            }
        }
    };

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
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.TRANSPARENT);

        android.util.DisplayMetrics metrics = new android.util.DisplayMetrics();
        getWindowManager().getDefaultDisplay().getMetrics(metrics);
        int panelHeight = (int) (metrics.heightPixels * 0.65f);

        FrameLayout panel = new FrameLayout(this);
        panel.setBackgroundColor(Color.TRANSPARENT);

        panelParams = new FrameLayout.LayoutParams(
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
                if (!url.contains("/companion")) return;

                // Voice default
                view.evaluateJavascript(
                    "if(!localStorage.getItem('based_companion_voice')){" +
                    "  localStorage.setItem('based_companion_voice','true');}", null);

                // Message persistence: production may not have the localStorage save/restore
                // code yet (dev branch not deployed). Inject it here so Android always has it.
                // SAVE: MutationObserver on .companion-messages serialises all visible bubbles
                //       to localStorage on every DOM change.
                // RESTORE: After React mounts (container exists + empty), if saved messages
                //          exist we walk the React fiber tree to call the messages setState
                //          directly — this puts history back in React state so the API also
                //          gets the correct conversation context on the next send().
                view.evaluateJavascript(
                    "(function(){" +

                    // --- helpers ---
                    "  function getFiberState(el){" +
                    "    var key=Object.keys(el).find(function(k){return k.startsWith('__reactFiber')||k.startsWith('__reactInternalInstance');});" +
                    "    if(!key)return null;" +
                    "    var fiber=el[key];" +
                    // Walk up to find the function component that owns the messages state
                    "    var node=fiber;" +
                    "    while(node){" +
                    "      if(node.memoizedState&&node.stateNode===null){" +
                    // Function component fiber — walk the hook linked list
                    "        var hook=node.memoizedState;" +
                    "        while(hook){" +
                    "          if(Array.isArray(hook.memoizedState)&&hook.queue&&typeof hook.queue.dispatch==='function'){" +
                    "            return hook.queue.dispatch;" +
                    "          }" +
                    "          hook=hook.next;" +
                    "        }" +
                    "      }" +
                    "      node=node.return;" +
                    "    }" +
                    "    return null;" +
                    "  }" +

                    // --- RESTORE ---
                    "  function tryRestore(){" +
                    "    var container=document.querySelector('.companion-messages');" +
                    "    if(!container){setTimeout(tryRestore,300);return;}" +
                    // Only restore if React rendered an empty messages list
                    "    var existingBubbles=container.querySelectorAll('.companion-bubble');" +
                    "    if(existingBubbles.length>0)return;" +
                    "    var stored=null;" +
                    "    try{var raw=localStorage.getItem('based_companion_messages');if(raw)stored=JSON.parse(raw);}catch(e){}" +
                    "    if(!stored||!Array.isArray(stored)||stored.length===0)return;" +
                    // Try React fiber setState first (keeps history in React state for API)
                    "    var dispatch=getFiberState(container);" +
                    "    if(dispatch){" +
                    "      try{dispatch(stored);return;}catch(e){}" +
                    "    }" +
                    // Fallback: inject DOM nodes so at least messages are visible
                    "    var frag=document.createDocumentFragment();" +
                    "    stored.forEach(function(m){" +
                    "      if(!m.content||!m.content.trim())return;" +
                    "      var wrapper=document.createElement('div');" +
                    "      var bubble=document.createElement('div');" +
                    "      bubble.className='companion-bubble companion-bubble--'+(m.role==='user'?'user':'assistant');" +
                    "      var span=document.createElement('span');" +
                    "      span.textContent=m.content;" +
                    "      bubble.appendChild(span);" +
                    "      wrapper.appendChild(bubble);" +
                    "      frag.appendChild(wrapper);" +
                    "    });" +
                    // Remove the 'i'm here' empty state placeholder before inserting
                    "    var empty=container.querySelector('.companion-overlay-empty');" +
                    "    if(empty)empty.style.display='none';" +
                    "    container.insertBefore(frag,container.firstChild);" +
                    "  }" +

                    // --- SAVE: observe and persist on every change ---
                    "  function setupPersistence(){" +
                    "    var container=document.querySelector('.companion-messages');" +
                    "    if(!container){setTimeout(setupPersistence,400);return;}" +
                    "    function saveMsgs(){" +
                    "      var bubbles=container.querySelectorAll('.companion-bubble');" +
                    "      var msgs=[];" +
                    "      bubbles.forEach(function(b){" +
                    "        var role=b.classList.contains('companion-bubble--user')?'user':'assistant';" +
                    "        var text=(b.querySelector('span')||b).textContent||'';" +
                    "        if(text.trim())msgs.push({role:role,content:text.trim()});" +
                    "      });" +
                    "      if(msgs.length>0){" +
                    "        try{localStorage.setItem('based_companion_messages',JSON.stringify(msgs));}catch(e){}" +
                    "      } else {" +
                    "        localStorage.removeItem('based_companion_messages');" +
                    "      }" +
                    "    }" +
                    "    var obs=new MutationObserver(saveMsgs);" +
                    "    obs.observe(container,{childList:true,subtree:true,characterData:true});" +
                    "    window.__abMsgObserver=obs;" +
                    "  }" +

                    // Give React ~500 ms to mount before we attempt restore + start observing
                    "  setTimeout(function(){tryRestore();setupPersistence();},500);" +
                    "})()", null);

                // window.close bridge
                view.evaluateJavascript(
                    "window.close=function(){" +
                    "  if(window.AndroidBridge)window.AndroidBridge.close();};", null);

                // Thinking-state bridge: wrap fetch to signal bubble when /api/companion is
                // in-flight. Injected AFTER the existing fetch interceptor so it wraps the
                // already-patched window.fetch (which attaches screenshot frames).
                view.evaluateJavascript(
                    "(function(){" +
                    "  var _origFetch=window.fetch;" +
                    "  window.fetch=function(url,opts){" +
                    "    var result=_origFetch.apply(this,arguments);" +
                    "    if(typeof url==='string'&&url.includes('/api/companion')){" +
                    "      if(window.AndroidBridge)window.AndroidBridge.setThinking(true);" +
                    "      result.then(function(){" +
                    "        if(window.AndroidBridge)window.AndroidBridge.setThinking(false);" +
                    "      }).catch(function(){" +
                    "        if(window.AndroidBridge)window.AndroidBridge.setThinking(false);" +
                    "      });" +
                    "    }" +
                    "    return result;" +
                    "  };" +
                    "})()", null);

                // Inject screen + face-camera UI from Android — no web deploy required.
                view.evaluateJavascript(
                    "(function inject(){" +
                    "  var row=document.querySelector('.companion-capture-row');" +
                    "  if(!row){setTimeout(inject,300);return;}" +
                    "  if(document.getElementById('__ab_screen_btn'))return;" +

                    // ── Shared state ──────────────────────────────────────────
                    "  window.__abFrame=null;" +       // latest screen frame (single-use)
                    "  window.__abPhotoFrame=null;" +  // latest back-camera photo (single-use)
                    "  window.__abCamFrame=null;" +    // latest face camera frame (continuous)
                    "  window.__abCamOn=false;" +

                    // ── Toast-style error banner (replaces alert() which is silent in WebView) ──
                    "  function showError(msg){" +
                    "    console.error('[Based Android] '+msg);" +
                    "    var t=document.getElementById('__ab_err_toast');" +
                    "    if(!t){" +
                    "      t=document.createElement('div');" +
                    "      t.id='__ab_err_toast';" +
                    "      t.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);'" +
                    "        +'background:rgba(200,50,50,0.92);color:#fff;font-size:13px;padding:8px 16px;'" +
                    "        +'border-radius:8px;z-index:99999;pointer-events:none;display:none;max-width:80vw;text-align:center;';" +
                    "      document.body.appendChild(t);" +
                    "    }" +
                    "    t.textContent=msg;" +
                    "    t.style.display='block';" +
                    "    clearTimeout(t.__hideTimer);" +
                    "    t.__hideTimer=setTimeout(function(){t.style.display='none';},4000);" +
                    "  }" +

                    // ── Shared helpers ────────────────────────────────────────
                    "  var inputArea=document.querySelector('.companion-input-area');" +
                    "  var preview=document.createElement('div');" +
                    "  preview.id='__ab_preview';" +
                    "  preview.style.cssText='display:none;padding:6px 12px;gap:8px;flex-direction:column;background:rgba(255,255,255,0.04);border-top:1px solid rgba(255,255,255,0.08);';" +
                    "  var thumbRow=document.createElement('div');" +
                    "  thumbRow.style.cssText='display:flex;gap:8px;align-items:center;';" +
                    "  var screenThumb=document.createElement('img');" +
                    "  screenThumb.id='__ab_screen_thumb';" +
                    "  screenThumb.title='Screen';" +
                    "  screenThumb.style.cssText='display:none;width:90px;height:50px;object-fit:cover;border-radius:4px;border:1px solid rgba(255,200,0,0.4);';" +
                    "  var photoThumb=document.createElement('img');" +
                    "  photoThumb.id='__ab_photo_thumb';" +
                    "  photoThumb.title='Photo';" +
                    "  photoThumb.style.cssText='display:none;width:90px;height:50px;object-fit:cover;border-radius:4px;border:1px solid rgba(255,200,0,0.4);';" +
                    "  var camThumb=document.createElement('img');" +
                    "  camThumb.id='__ab_cam_thumb';" +
                    "  camThumb.title='Camera';" +
                    "  camThumb.style.cssText='display:none;width:50px;height:50px;object-fit:cover;border-radius:50%;border:1px solid rgba(100,200,255,0.4);';" +
                    "  var askBtn=document.createElement('button');" +
                    "  askBtn.className='companion-capture-btn active';" +
                    "  askBtn.style.cssText='flex:1;font-size:11px;';" +
                    "  askBtn.textContent='\\u25C9 Ask about what you see';" +
                    "  askBtn.onclick=function(){" +
                    "    var msg;" +
                    "    if(window.__abPhotoFrame&&!window.__abFrame){" +
                    "      msg='What product or object is this?';" +
                    "    }else if(window.__abCamOn&&!window.__abFrame&&!window.__abPhotoFrame){" +
                    "      msg='What do you see in my face? How do I look?';" +
                    "    }else{" +
                    "      msg='What can you see right now?';" +
                    "    }" +
                    "    sendWithFrame(msg);" +
                    "  };" +
                    "  thumbRow.appendChild(screenThumb);" +
                    "  thumbRow.appendChild(photoThumb);" +
                    "  thumbRow.appendChild(camThumb);" +
                    "  thumbRow.appendChild(askBtn);" +
                    "  preview.appendChild(thumbRow);" +
                    "  if(inputArea)inputArea.insertBefore(preview,inputArea.firstChild);" +

                    "  function refreshPreview(){" +
                    "    var any=!!(window.__abFrame||window.__abPhotoFrame||window.__abCamOn);" +
                    "    preview.style.display=any?'flex':'none';" +
                    "  }" +

                    // ── sendWithFrame: sets textarea + clicks send ────────────
                    "  function sendWithFrame(text){" +
                    "    var ta=document.querySelector('.companion-textarea');" +
                    "    var sb=document.querySelector('.companion-send');" +
                    "    if(!ta||!sb){console.error('[Based Android] sendWithFrame: textarea or send btn not found');return;}" +
                    "    try{" +
                    "      var desc=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value');" +
                    "      if(desc&&typeof desc.set==='function'){" +
                    "        desc.set.call(ta,text);" +
                    "      }else{" +
                    "        ta.value=text;" +
                    "      }" +
                    "    }catch(e){" +
                    "      console.error('[Based Android] sendWithFrame setter error:',e);" +
                    "      ta.value=text;" +
                    "    }" +
                    "    ta.dispatchEvent(new Event('input',{bubbles:true}));" +
                    "    ta.dispatchEvent(new Event('change',{bubbles:true}));" +
                    "    setTimeout(function(){sb.click();},80);" +
                    "  }" +

                    // ── Screen snapshot button (single-shot, not a toggle) ────
                    "  var screenBtn=document.createElement('button');" +
                    "  screenBtn.id='__ab_screen_btn';" +
                    "  screenBtn.className='companion-capture-btn';" +
                    "  screenBtn.textContent='\\u25C9 Screen';" +
                    "  screenBtn.onclick=function(){" +
                    "    screenBtn.textContent='\\u25C9 Capturing…';" +
                    "    screenBtn.disabled=true;" +
                    "    window.AndroidBridge.startScreenCapture();" +
                    "  };" +
                    "  row.insertBefore(screenBtn,row.firstChild);" +

                    // ── Photo button (single-shot back camera) ────────────────
                    "  var photoBtn=document.createElement('button');" +
                    "  photoBtn.id='__ab_photo_btn';" +
                    "  photoBtn.className='companion-capture-btn';" +
                    "  photoBtn.textContent='\\u25C9 Photo';" +
                    "  photoBtn.onclick=function(){" +
                    "    photoBtn.textContent='\\u25C9 Snapping\\u2026';" +
                    "    photoBtn.disabled=true;" +
                    "    window.AndroidBridge.takePhoto();" +
                    "  };" +
                    "  row.insertBefore(photoBtn,screenBtn.nextSibling);" +

                    // ── Camera (face) toggle button — uses Camera2 bridge ─────
                    "  var camBtn=document.createElement('button');" +
                    "  camBtn.id='__ab_cam_btn';" +
                    "  camBtn.className='companion-capture-btn';" +
                    "  camBtn.textContent='\\u25C9 Face';" +
                    "  camBtn.onclick=function(){" +
                    "    if(window.__abCamOn){" +
                    "      window.AndroidBridge.stopCameraCapture();" +
                    "      window.__abCamOn=false;window.__abCamFrame=null;" +
                    "      camBtn.textContent='\\u25C9 Face';" +
                    "      camBtn.classList.remove('active');" +
                    "      var th=document.getElementById('__ab_cam_thumb');" +
                    "      if(th)th.style.display='none';" +
                    "      refreshPreview();" +
                    "    }else{" +
                    "      window.AndroidBridge.startCameraCapture();" +
                    "      window.__abCamOn=true;" +
                    "      camBtn.textContent='\\u25C9 Seeing';" +
                    "      camBtn.classList.add('active');" +
                    "      refreshPreview();" +
                    "    }" +
                    "  };" +
                    "  row.insertBefore(camBtn,photoBtn.nextSibling);" +

                    // ── Camera frame receiver (called from Java via Camera2) ──
                    "  window.onCameraFrame=function(b64){" +
                    "    if(!b64){console.error('[Based Android] onCameraFrame: empty frame');return;}" +
                    "    window.__abCamFrame='data:image/jpeg;base64,'+b64;" +
                    "    var th=document.getElementById('__ab_cam_thumb');" +
                    "    if(th){th.src=window.__abCamFrame;th.style.display='block';}" +
                    "  };" +

                    // ── Photo frame receiver (single-shot back camera) ─────────
                    "  window.onPhotoFrame=function(b64){" +
                    "    if(!b64){console.error('[Based Android] onPhotoFrame: empty frame');return;}" +
                    "    window.__abPhotoFrame='data:image/jpeg;base64,'+b64;" +
                    "    var th=document.getElementById('__ab_photo_thumb');" +
                    "    if(th){th.src=window.__abPhotoFrame;th.style.display='block';}" +
                    "    var btn=document.getElementById('__ab_photo_btn');" +
                    "    if(btn){btn.textContent='\\u25C9 Photo';btn.disabled=false;}" +
                    "    refreshPreview();" +
                    "  };" +

                    // ── Screen frame receiver ─────────────────────────────────
                    "  window.onScreenFrame=function(b64){" +
                    "    if(!b64){console.error('[Based Android] onScreenFrame: empty frame');return;}" +
                    "    window.__abFrame='data:image/jpeg;base64,'+b64;" +
                    "    var th=document.getElementById('__ab_screen_thumb');" +
                    "    if(th){th.src=window.__abFrame;th.style.display='block';}" +
                    "    var btn=document.getElementById('__ab_screen_btn');" +
                    "    if(btn){btn.textContent='\\u25C9 Screen';btn.disabled=false;}" +
                    "    refreshPreview();" +
                    "  };" +
                    "  window.onScreenCaptureDenied=function(){" +
                    "    window.__abFrame=null;" +
                    "    var btn=document.getElementById('__ab_screen_btn');" +
                    "    if(btn){btn.textContent='\\u25C9 Screen';btn.disabled=false;}" +
                    "    screenThumb.style.display='none';refreshPreview();" +
                    "    showError('Screen capture permission denied');" +
                    "  };" +
                    "  window.onScreenCaptureStopped=function(){" +
                    "    window.__abFrame=null;" +
                    "    var btn=document.getElementById('__ab_screen_btn');" +
                    "    if(btn){btn.textContent='\\u25C9 Screen';btn.disabled=false;}" +
                    "    screenThumb.style.display='none';refreshPreview();" +
                    "  };" +

                    // ── Fetch interceptor — priority: screen > photo > face ───
                    "  var _f=window.fetch;" +
                    "  window.fetch=function(url,opts){" +
                    "    if(typeof url==='string'&&url.includes('/api/companion')&&opts&&opts.body){" +
                    "      var frame=window.__abFrame||window.__abPhotoFrame||window.__abCamFrame;" +
                    "      if(frame){" +
                    "        try{" +
                    "          if(typeof opts.body==='string'){" +
                    "            var b=JSON.parse(opts.body);" +
                    "            b.screenshot=frame;" +
                    // Clear single-use frames after attaching; face frame stays
                    "            if(window.__abFrame){window.__abFrame=null;" +
                    "              var st=document.getElementById('__ab_screen_thumb');if(st)st.style.display='none';}" +
                    "            else if(window.__abPhotoFrame){window.__abPhotoFrame=null;" +
                    "              var pt=document.getElementById('__ab_photo_thumb');if(pt)pt.style.display='none';" +
                    "              refreshPreview();}" +
                    "            opts=Object.assign({},opts,{body:JSON.stringify(b)});" +
                    "          }" +
                    "        }catch(e){console.error('[Based Android] fetch interceptor parse error:',e);}" +
                    "      }" +
                    "    }" +
                    "    return _f.apply(this,arguments);" +
                    "  };" +
                    "})()", null);
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

        String[] permsNeeded = new java.util.ArrayList<String>() {{
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
                add(Manifest.permission.RECORD_AUDIO);
            if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
                add(Manifest.permission.CAMERA);
        }}.toArray(new String[0]);
        if (permsNeeded.length > 0) ActivityCompat.requestPermissions(this, permsNeeded, 1001);

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

        // Shift the panel up by the exact IME height when the keyboard opens.
        // WindowCompat.setDecorFitsSystemWindows(false) ensures the inset pipeline
        // delivers non-zero IME insets to ViewCompat listeners (FLAG_LAYOUT_NO_LIMITS
        // broke this by bypassing the inset dispatch pipeline entirely).
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            boolean imeVisible = insets.isVisible(androidx.core.view.WindowInsetsCompat.Type.ime());
            int imeHeight = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.ime()).bottom;
            panelParams.bottomMargin = imeVisible ? imeHeight : 0;
            panel.setLayoutParams(panelParams);
            return insets;
        });

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

        // Register failure callback so grabFrame() can notify the WebView when VirtualDisplay
        // produces no frame within the retry window. This resets the "Capturing…" button state.
        ScreenCaptureService.captureFailedCallback = () -> {
            CompanionActivity a  = activityRef.get();
            WebView           wv = webViewRef.get();
            if (a == null || wv == null) return;
            a.runOnUiThread(() ->
                wv.evaluateJavascript(
                    "window.onScreenCaptureStopped&&window.onScreenCaptureStopped()", null));
        };

        // Register visibility callback so ScreenCaptureService can hide/show
        // the companion window around each screen capture.
        // Use window alpha=0/1 instead of View.INVISIBLE — alpha=0 immediately
        // removes the window from SurfaceFlinger composition, whereas INVISIBLE
        // can linger for several frames in the compositor buffer.
        ScreenCaptureService.visibilityCallback = new ScreenCaptureService.VisibilityCallback() {
            private void setAlpha(float alpha) {
                CompanionActivity a = activityRef.get();
                if (a == null) return;
                Runnable r = () -> {
                    WindowManager.LayoutParams lp = a.getWindow().getAttributes();
                    lp.alpha = alpha;
                    a.getWindow().setAttributes(lp);
                };
                // Execute inline if already on the main thread; post otherwise.
                if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) {
                    r.run();
                } else {
                    a.runOnUiThread(r);
                }
            }
            @Override public void hide() { setAlpha(0f); }
            @Override public void show() { setAlpha(1f); }
        };
    }

    // ── Camera2 implementation ────────────────────────────────────────────────

    private void startCameraCapture() {
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            if (webView != null) {
                runOnUiThread(() -> webView.evaluateJavascript(
                    "window.showError&&window.showError('Camera permission not granted')", null));
            }
            return;
        }

        cameraThread = new HandlerThread("CameraCapture");
        cameraThread.start();
        cameraHandler = new Handler(cameraThread.getLooper());

        cameraImageReader = ImageReader.newInstance(640, 480, ImageFormat.JPEG, 2);

        CameraManager manager = (CameraManager) getSystemService(Context.CAMERA_SERVICE);
        try {
            String frontCameraId = null;
            for (String id : manager.getCameraIdList()) {
                CameraCharacteristics ch = manager.getCameraCharacteristics(id);
                Integer facing = ch.get(CameraCharacteristics.LENS_FACING);
                if (facing != null && facing == CameraCharacteristics.LENS_FACING_FRONT) {
                    frontCameraId = id;
                    break;
                }
            }
            if (frontCameraId == null) {
                // Fall back to first available camera
                String[] ids = manager.getCameraIdList();
                if (ids.length > 0) frontCameraId = ids[0];
            }
            if (frontCameraId == null) {
                notifyCameraError("No camera found on this device");
                return;
            }

            final String cameraId = frontCameraId;
            manager.openCamera(cameraId, new CameraDevice.StateCallback() {
                @Override
                public void onOpened(@NonNull CameraDevice camera) {
                    cameraDevice = camera;
                    try {
                        CaptureRequest.Builder builder =
                                camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
                        builder.addTarget(cameraImageReader.getSurface());

                        camera.createCaptureSession(
                                Arrays.asList(cameraImageReader.getSurface()),
                                new CameraCaptureSession.StateCallback() {
                                    @Override
                                    public void onConfigured(@NonNull CameraCaptureSession session) {
                                        captureSession = session;
                                        try {
                                            session.setRepeatingRequest(
                                                builder.build(), null, cameraHandler);
                                        } catch (CameraAccessException e) {
                                            notifyCameraError("Camera repeating request failed: " + e.getMessage());
                                            return;
                                        }
                                        cameraRunning = true;
                                        // Start the periodic frame grab
                                        cameraHandler.post(cameraFrameRunnable);
                                    }
                                    @Override
                                    public void onConfigureFailed(@NonNull CameraCaptureSession session) {
                                        notifyCameraError("Camera session config failed");
                                    }
                                }, cameraHandler);
                    } catch (CameraAccessException e) {
                        notifyCameraError("Camera access error: " + e.getMessage());
                    }
                }

                @Override
                public void onDisconnected(@NonNull CameraDevice camera) {
                    camera.close();
                    cameraDevice = null;
                }

                @Override
                public void onError(@NonNull CameraDevice camera, int error) {
                    camera.close();
                    cameraDevice = null;
                    notifyCameraError("Camera error code: " + error);
                }
            }, cameraHandler);

        } catch (CameraAccessException | SecurityException e) {
            notifyCameraError("Could not open camera: " + e.getMessage());
        }
    }

    private void stopCameraCapture() {
        cameraRunning = false;
        if (cameraHandler != null) cameraHandler.removeCallbacks(cameraFrameRunnable);
        if (captureSession != null) {
            try { captureSession.close(); } catch (Exception ignored) {}
            captureSession = null;
        }
        if (cameraDevice != null) {
            cameraDevice.close();
            cameraDevice = null;
        }
        if (cameraImageReader != null) {
            cameraImageReader.close();
            cameraImageReader = null;
        }
        if (cameraThread != null) {
            cameraThread.quitSafely();
            cameraThread = null;
        }
        cameraHandler = null;
    }

    private void grabCameraFrame() {
        if (cameraImageReader == null || captureSession == null) return;
        Image image = null;
        try {
            image = cameraImageReader.acquireLatestImage();
            if (image == null) return;

            ByteBuffer buffer = image.getPlanes()[0].getBuffer();
            byte[] bytes = new byte[buffer.remaining()];
            buffer.get(bytes);

            // Compress to JPEG at 50% quality
            Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bmp != null) {
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                bmp.compress(Bitmap.CompressFormat.JPEG, 50, baos);
                bmp.recycle();
                final String base64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
                if (webView != null) {
                    runOnUiThread(() -> webView.evaluateJavascript(
                        "window.onCameraFrame&&window.onCameraFrame('" + base64 + "')", null));
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (image != null) image.close();
        }
    }

    private void notifyCameraError(String msg) {
        if (webView != null) {
            runOnUiThread(() -> webView.evaluateJavascript(
                "window.showError&&window.showError('" + msg.replace("'", "\\'") + "')", null));
        }
    }

    // ── Back-camera single-shot photo ─────────────────────────────────────────

    private void takePhoto() {
        if (photoCapturing) return;
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            notifyPhotoError("Camera permission not granted");
            return;
        }

        photoCapturing = true;

        photoThread = new HandlerThread("PhotoCapture");
        photoThread.start();
        photoHandler = new Handler(photoThread.getLooper());

        // 1280×720 JPEG — single buffered (only need one frame)
        photoImageReader = ImageReader.newInstance(1280, 720, ImageFormat.JPEG, 1);

        CameraManager manager = (CameraManager) getSystemService(Context.CAMERA_SERVICE);
        try {
            String backCameraId = null;
            for (String id : manager.getCameraIdList()) {
                CameraCharacteristics ch = manager.getCameraCharacteristics(id);
                Integer facing = ch.get(CameraCharacteristics.LENS_FACING);
                if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                    backCameraId = id;
                    break;
                }
            }
            if (backCameraId == null) {
                // Fall back to first available camera
                String[] ids = manager.getCameraIdList();
                if (ids.length > 0) backCameraId = ids[0];
            }
            if (backCameraId == null) {
                notifyPhotoError("No back camera found on this device");
                stopPhotoCamera();
                return;
            }

            final String cameraId = backCameraId;
            manager.openCamera(cameraId, new CameraDevice.StateCallback() {
                @Override
                public void onOpened(@NonNull CameraDevice camera) {
                    photoCameraDevice = camera;
                    try {
                        CaptureRequest.Builder builder =
                                camera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
                        builder.addTarget(photoImageReader.getSurface());

                        camera.createCaptureSession(
                                Arrays.asList(photoImageReader.getSurface()),
                                new CameraCaptureSession.StateCallback() {
                                    @Override
                                    public void onConfigured(@NonNull CameraCaptureSession session) {
                                        photoCaptureSession = session;
                                        try {
                                            session.capture(
                                                builder.build(),
                                                new CameraCaptureSession.CaptureCallback() {
                                                    @Override
                                                    public void onCaptureCompleted(
                                                            @NonNull CameraCaptureSession session,
                                                            @NonNull CaptureRequest request,
                                                            @NonNull android.hardware.camera2.TotalCaptureResult result) {
                                                        processPhotoCapture();
                                                    }
                                                },
                                                photoHandler);
                                        } catch (CameraAccessException e) {
                                            notifyPhotoError("Photo capture failed: " + e.getMessage());
                                            stopPhotoCamera();
                                        }
                                    }
                                    @Override
                                    public void onConfigureFailed(@NonNull CameraCaptureSession session) {
                                        notifyPhotoError("Photo session config failed");
                                        stopPhotoCamera();
                                    }
                                }, photoHandler);
                    } catch (CameraAccessException e) {
                        notifyPhotoError("Photo camera access error: " + e.getMessage());
                        stopPhotoCamera();
                    }
                }

                @Override
                public void onDisconnected(@NonNull CameraDevice camera) {
                    camera.close();
                    photoCameraDevice = null;
                    stopPhotoCamera();
                }

                @Override
                public void onError(@NonNull CameraDevice camera, int error) {
                    camera.close();
                    photoCameraDevice = null;
                    notifyPhotoError("Photo camera error code: " + error);
                    stopPhotoCamera();
                }
            }, photoHandler);

        } catch (CameraAccessException | SecurityException e) {
            notifyPhotoError("Could not open back camera: " + e.getMessage());
            stopPhotoCamera();
        }
    }

    private void processPhotoCapture() {
        if (photoImageReader == null) {
            notifyPhotoError("Photo reader not available");
            stopPhotoCamera();
            return;
        }
        Image image = null;
        try {
            image = photoImageReader.acquireLatestImage();
            if (image == null) {
                notifyPhotoError("No photo frame received");
                stopPhotoCamera();
                return;
            }

            ByteBuffer buffer = image.getPlanes()[0].getBuffer();
            byte[] bytes = new byte[buffer.remaining()];
            buffer.get(bytes);

            // 80% quality — higher than face camera (50%) for product identification
            Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bmp != null) {
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                bmp.compress(Bitmap.CompressFormat.JPEG, 80, baos);
                bmp.recycle();
                final String base64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
                if (webView != null) {
                    runOnUiThread(() -> webView.evaluateJavascript(
                        "window.onPhotoFrame&&window.onPhotoFrame('" + base64 + "')", null));
                }
            } else {
                notifyPhotoError("Could not decode photo");
            }
        } catch (Exception e) {
            notifyPhotoError("Photo processing error: " + e.getMessage());
        } finally {
            if (image != null) image.close();
            stopPhotoCamera();
        }
    }

    private void stopPhotoCamera() {
        photoCapturing = false;
        if (photoCaptureSession != null) {
            try { photoCaptureSession.close(); } catch (Exception ignored) {}
            photoCaptureSession = null;
        }
        if (photoCameraDevice != null) {
            photoCameraDevice.close();
            photoCameraDevice = null;
        }
        if (photoImageReader != null) {
            photoImageReader.close();
            photoImageReader = null;
        }
        if (photoThread != null) {
            photoThread.quitSafely();
            photoThread = null;
        }
        photoHandler = null;
    }

    private void notifyPhotoError(String msg) {
        photoCapturing = false;
        if (webView != null) {
            runOnUiThread(() -> webView.evaluateJavascript(
                "window.showError&&window.showError('" + msg.replace("'", "\\'") + "');" +
                "var b=document.getElementById('__ab_photo_btn');" +
                "if(b){b.textContent='\\u25C9 Photo';b.disabled=false;}", null));
        }
    }

    // ── Activity lifecycle ────────────────────────────────────────────────────

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
            // Restore companion visibility on denial.
            // vc.show() detects the main thread and runs setAttributes inline.
            ScreenCaptureService.VisibilityCallback vc = ScreenCaptureService.visibilityCallback;
            if (vc != null) vc.show();

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
        stopCameraCapture();
        stopPhotoCamera();
        ScreenCaptureService.frameCallback        = null;
        ScreenCaptureService.captureFailedCallback = null;
        ScreenCaptureService.visibilityCallback   = null;
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
                // 1. Apply alpha=0 immediately on the UI thread (no extra runOnUiThread hop).
                WindowManager.LayoutParams lp = getWindow().getAttributes();
                lp.alpha = 0f;
                getWindow().setAttributes(lp);

                // 2. Give the WindowManager 5 vsyncs (~83ms at 60fps) to process the alpha
                //    change before launching the permission dialog. This guarantees the
                //    companion is invisible before any MediaProjection surface is created.
                new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                    MediaProjectionManager mpm =
                        (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
                    startActivityForResult(mpm.createScreenCaptureIntent(), REQUEST_MEDIA_PROJECTION);
                }, 83);
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

        @JavascriptInterface
        public void startCameraCapture() {
            runOnUiThread(() -> CompanionActivity.this.startCameraCapture());
        }

        @JavascriptInterface
        public void stopCameraCapture() {
            CompanionActivity.this.stopCameraCapture();
        }

        @JavascriptInterface
        public void takePhoto() {
            runOnUiThread(() -> CompanionActivity.this.takePhoto());
        }

        /**
         * Called from JS when a /api/companion fetch starts (active=true) or completes
         * (active=false). Broadcasts to FloatingBubbleService so it can animate the bubble.
         */
        @JavascriptInterface
        public void setThinking(boolean active) {
            Intent intent = new Intent(FloatingBubbleService.ACTION_BUBBLE_THINKING);
            intent.putExtra(FloatingBubbleService.EXTRA_THINKING_ACTIVE, active);
            intent.setPackage(getPackageName());
            sendBroadcast(intent);
        }
    }

    private int dpToPx(int dp) {
        return Math.round(dp * getResources().getDisplayMetrics().density);
    }
}
