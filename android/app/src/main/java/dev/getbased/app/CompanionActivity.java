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
import android.location.Location;
import android.location.LocationManager;
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
    private FrameLayout panel;
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
    private String               pendingProactiveContext = null;
    private boolean              cameraFacingFront = false; // false = back (surroundings), true = front (selfie)
    private int                  cameraSensorOrientation = 90; // set when face/cam camera opens
    private int                  photoSensorOrientation  = 90; // set when photo camera opens
    // Physical device orientation (0/90/180/270) from OrientationEventListener.
    // We use this instead of Display.getRotation() because Display.getRotation()
    // returns 0 when the Activity is portrait-locked, even if the device is landscape.
    private volatile int                          physicalOrientation = 0;
    private android.view.OrientationEventListener orientationListener;

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
    public void onConfigurationChanged(@NonNull android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Recalculate panel height so it stays 65% of the screen in both portrait and landscape
        if (panel != null && panelParams != null) {
            android.util.DisplayMetrics metrics = new android.util.DisplayMetrics();
            getWindowManager().getDefaultDisplay().getMetrics(metrics);
            panelParams.height = (int) (metrics.heightPixels * 0.65f);
            panel.setLayoutParams(panelParams);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String ctx = intent.getStringExtra("PROACTIVE_CONTEXT");
        if (ctx != null) {
            if (webView != null) injectProactiveTrigger(ctx);
            else pendingProactiveContext = ctx;
        }
    }

    private void injectProactiveTrigger(String context) {
        if (webView == null) return;
        final String safe = context.replaceAll("[^a-z]", "");
        runOnUiThread(() -> webView.evaluateJavascript(
            "setTimeout(function(){" +
            "  try{" +
            "    if(window.__abProactiveCallback)window.__abProactiveCallback({context:'" + safe + "'});" +
            "    else window.dispatchEvent(new CustomEvent('proactive-trigger',{detail:{context:'" + safe + "'}}));" +
            "  }catch(e){}" +
            "},1500);", null));
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

        panel = new FrameLayout(this);
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
        // Marker so the web app can detect the Android app (hides in-app purchase CTAs).
        ws.setUserAgentString(ws.getUserAgentString() + " BasedApp");

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(webView, true);

        webView.setBackgroundColor(Color.parseColor("#08070e")); // dark bg during load; companion fills it

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (ExternalLinks.isExternal(url)) {
                    // OAuth / external sites must open in a real browser (Custom Tab).
                    ExternalLinks.open(CompanionActivity.this, url);
                    return true;
                }
                return false; // let the WebView load getbased.dev itself
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (!url.contains("/companion")) return;

                // Android CSS: disable the Electron slide-in animation (starts opacity:0 —
                // if it doesn't fire the panel stays invisible). Force opacity:1 immediately.
                // The slide-up effect is handled at the Java ViewPropertyAnimator level.
                // Also make the capture row horizontally scrollable so all buttons are reachable.
                view.evaluateJavascript(
                    "(function(){" +
                    "  if(document.getElementById('__ab_android_css'))return;" +
                    "  var s=document.createElement('style');" +
                    "  s.id='__ab_android_css';" +
                    "  s.textContent=" +
                    "    '.companion-overlay-root{" +
                    "      animation:none!important;opacity:1!important;transform:none!important;" +
                    "      top:0!important;left:0!important;right:0!important;bottom:0!important;" +
                    "      width:auto!important;border-radius:0!important" +
                    "    }" +
                    "    .companion-capture-row{" +
                    "      overflow-x:auto!important;flex-wrap:nowrap!important;" +
                    "      -webkit-overflow-scrolling:touch!important" +
                    "    }" +
                    "    .companion-capture-row .companion-capture-btn," +
                    "    .companion-capture-row .companion-voice-btn{" +
                    "      flex-shrink:0!important;white-space:nowrap!important" +
                    "    }';" +
                    "  document.head.appendChild(s);" +
                    "})()", null);

                // Intercept SpeechRecognition so we can abort it when Based is speaking.
                // This prevents the mic from capturing TTS audio and sending it back as
                // a new user message (which causes two overlapping voices).
                view.evaluateJavascript(
                    "(function(){" +
                    "  var SR=window.webkitSpeechRecognition||window.SpeechRecognition;" +
                    "  if(!SR)return;" +
                    "  var _start=SR.prototype.start;" +
                    "  SR.prototype.start=function(){" +
                    "    if(window.__abSpeakingActive)return;" + // block start while TTS playing
                    "    window.__abActiveSR=this;" +
                    "    _start.apply(this,arguments);" +
                    "  };" +
                    "})()", null);

                // electronAPI shim — routes Electron IPC calls to AndroidBridge
                view.evaluateJavascript(
                    "(function(){" +
                    "  if(window.electronAPI)return;" +
                    "  window.electronAPI={" +
                    "    setSpeaking:function(s,t){if(window.AndroidBridge)window.AndroidBridge.setSpeaking(!!s,t||'');}," +
                    "    onProactiveTrigger:function(cb){window.__abProactiveCallback=cb;}," +
                    "    hideForCapture:function(){}," +
                    "    showAfterCapture:function(){}," +
                    "    captureScreenMain:function(){return Promise.resolve(null);}," +
                    "    resizeStart:function(){}," +
                    "    setCompanionWidth:function(){}," +
                    "    resizeEnd:function(){}," +
                    "    hideCompanion:function(){if(window.AndroidBridge)window.AndroidBridge.close();}," +
                    "    showCompanion:function(){}" +
                    "  };" +
                    "})()", null);

                // Voice default
                view.evaluateJavascript(
                    "if(!localStorage.getItem('based_companion_voice')){" +
                    "  localStorage.setItem('based_companion_voice','true');}", null);

                // GPS Memory Anchors — one-shot last-known location fetch
                fetchLastKnownLocation();

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

                // Inline sign-in: after Supabase's 3s auth timeout + buffer, if still
                // not signed in inject an email+password form that calls the Supabase REST
                // auth endpoint directly — no navigation away from the companion needed.
                // On success the token is stored in localStorage and the page reloads,
                // which makes Supabase's getSession() pick it up on next mount.
                view.evaluateJavascript(
                    "setTimeout(function(){" +
                    "  var notice=document.querySelector('.companion-auth-notice');" +
                    "  if(!notice||!notice.textContent.includes('Sign in'))return;" +
                    "  if(document.getElementById('__ab_signin_form'))return;" +
                    "  var form=document.createElement('div');" +
                    "  form.id='__ab_signin_form';" +
                    "  form.style.cssText='display:flex;flex-direction:column;gap:8px;padding:4px 0;';" +
                    "  var inpStyle='padding:10px 12px;background:rgba(255,255,255,0.06);" +
                    "    border:1px solid rgba(201,168,124,0.3);border-radius:8px;color:#ede8d0;" +
                    "    font-size:14px;box-sizing:border-box;outline:none;width:100%;';" +
                    "  var email=document.createElement('input');" +
                    "  email.type='email';email.placeholder='Email address';email.style.cssText=inpStyle;" +
                    "  var pass=document.createElement('input');" +
                    "  pass.type='password';pass.placeholder='Password';pass.style.cssText=inpStyle;" +
                    "  var btn=document.createElement('button');" +
                    "  btn.textContent='\\u25C8 Sign In';" +
                    "  btn.style.cssText='padding:10px;background:#c9a87c;color:#0e0c17;" +
                    "    border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;';" +
                    "  var err=document.createElement('div');" +
                    "  err.style.cssText='color:#ff6b6b;font-size:12px;display:none;';" +
                    "  var hint=document.createElement('div');" +
                    "  hint.style.cssText='color:rgba(237,232,208,0.4);font-size:11px;text-align:center;margin-top:2px;';" +
                    "  hint.textContent='Signed up with Google? Open the Based app first.';" +
                    "  btn.onclick=function(){" +
                    "    var e=email.value.trim(),p=pass.value;" +
                    "    if(!e||!p){err.textContent='Enter email and password';err.style.display='block';return;}" +
                    "    btn.textContent='Signing in\\u2026';btn.disabled=true;err.style.display='none';" +
                    "    fetch('https://ooiqyptgaakasfczmiyp.supabase.co/auth/v1/token?grant_type=password',{" +
                    "      method:'POST'," +
                    "      headers:{" +
                    "        'apikey':'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vaXF5cHRnYWFrYXNmY3ptaXlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzMzY4NDUsImV4cCI6MjA5MzkxMjg0NX0.SSfe9CeIzZxvvXnkYwHIxO-RCJY0jFha2zbmfur7Lc8'," +
                    "        'Content-Type':'application/json'" +
                    "      }," +
                    "      body:JSON.stringify({email:e,password:p})" +
                    "    }).then(function(r){return r.json();}).then(function(d){" +
                    "      if(d.error||d.error_description){" +
                    "        err.textContent=d.error_description||d.error||'Sign in failed';" +
                    "        err.style.display='block';" +
                    "        btn.textContent='\\u25C8 Sign In';btn.disabled=false;" +
                    "      }else{" +
                    "        try{localStorage.setItem('sb-ooiqyptgaakasfczmiyp-auth-token',JSON.stringify(d));}catch(x){}" +
                    "        window.location.reload();" +
                    "      }" +
                    "    }).catch(function(){" +
                    "      err.textContent='Network error — check connection';" +
                    "      err.style.display='block';" +
                    "      btn.textContent='\\u25C8 Sign In';btn.disabled=false;" +
                    "    });" +
                    "  };" +
                    "  form.appendChild(email);" +
                    "  form.appendChild(pass);" +
                    "  form.appendChild(btn);" +
                    "  form.appendChild(err);" +
                    "  form.appendChild(hint);" +
                    "  notice.insertAdjacentElement('afterend',form);" +
                    "},3500);", null);

                // Feature 7: companion name bridge — read from localStorage on load,
                // and expose window.setBasedName() so the web UI can update it.
                view.evaluateJavascript(
                    "(function(){" +
                    "  var stored=localStorage.getItem('based_companion_name');" +
                    "  if(stored&&stored.trim()&&window.AndroidBridge){" +
                    "    window.AndroidBridge.setCompanionName(stored.trim());" +
                    "  }" +
                    // Expose a global function the web UI can call to update the name
                    "  window.setBasedName=function(name){" +
                    "    if(!name||!name.trim())return;" +
                    "    var n=name.trim().substring(0,20);" +
                    "    localStorage.setItem('based_companion_name',n);" +
                    "    if(window.AndroidBridge)window.AndroidBridge.setCompanionName(n);" +
                    "  };" +
                    "})()", null);

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

                // Inject photo + face-camera buttons. Screen capture is handled by the web
                // companion's own button (isAndroidBridge=true) to avoid duplicates.
                view.evaluateJavascript(
                    "(function inject(){" +
                    "  var row=document.querySelector('.companion-capture-row');" +
                    "  if(!row){setTimeout(inject,300);return;}" +
                    "  if(document.getElementById('__ab_photo_btn'))return;" +

                    "  window.__abPhotoFrame=null;" +
                    "  window.__abCamFrame=null;" +
                    "  window.__abCamOn=false;" +

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

                    "  var inputArea=document.querySelector('.companion-input-area');" +
                    "  var preview=document.createElement('div');" +
                    "  preview.id='__ab_preview';" +
                    "  preview.style.cssText='display:none;padding:6px 12px;gap:8px;flex-direction:column;background:rgba(255,255,255,0.04);border-top:1px solid rgba(255,255,255,0.08);';" +
                    "  var thumbRow=document.createElement('div');" +
                    "  thumbRow.style.cssText='display:flex;gap:8px;align-items:center;';" +
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
                    "    var msg=window.__abCamOn&&!window.__abPhotoFrame" +
                    "      ?'What do you see in my face? How do I look?'" +
                    "      :'What can you see right now?';" +
                    "    sendWithFrame(msg);" +
                    "  };" +
                    "  thumbRow.appendChild(photoThumb);" +
                    "  thumbRow.appendChild(camThumb);" +
                    "  thumbRow.appendChild(askBtn);" +
                    "  preview.appendChild(thumbRow);" +
                    "  if(inputArea)inputArea.insertBefore(preview,inputArea.firstChild);" +

                    "  function refreshPreview(){" +
                    "    preview.style.display=!!(window.__abPhotoFrame||window.__abCamOn)?'flex':'none';" +
                    "  }" +

                    "  function sendWithFrame(text){" +
                    "    var ta=document.querySelector('.companion-textarea');" +
                    "    var sb=document.querySelector('.companion-send');" +
                    "    if(!ta||!sb){console.error('[Based Android] sendWithFrame: no textarea/send');return;}" +
                    "    try{" +
                    "      var desc=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value');" +
                    "      if(desc&&typeof desc.set==='function'){desc.set.call(ta,text);}else{ta.value=text;}" +
                    "    }catch(e){ta.value=text;}" +
                    "    ta.dispatchEvent(new Event('input',{bubbles:true}));" +
                    "    ta.dispatchEvent(new Event('change',{bubbles:true}));" +
                    "    setTimeout(function(){sb.click();},80);" +
                    "  }" +

                    "  window.__abCamIsFront=false;" + // starts as back camera (surroundings)

                    "  var photoBtn=document.createElement('button');" +
                    "  photoBtn.id='__ab_photo_btn';" +
                    "  photoBtn.className='companion-capture-btn';" +
                    "  photoBtn.textContent='\\u25C9 Photo';" +
                    "  photoBtn.onclick=function(){" +
                    // If back cam is already streaming, grab its current frame instead of
                    // opening the camera a second time (Camera2 can't open the same lens twice).
                    "    if(window.__abCamOn&&!window.__abCamIsFront&&window.__abCamFrame){" +
                    "      window.onPhotoFrame&&window.onPhotoFrame(window.__abCamFrame.split(',')[1]);" +
                    "      return;" +
                    "    }" +
                    "    photoBtn.textContent='\\u25C9 Snapping\\u2026';" +
                    "    photoBtn.disabled=true;" +
                    "    window.AndroidBridge.takePhoto();" +
                    "  };" +
                    "  row.insertBefore(photoBtn,row.firstChild);" +

                    "  var camBtn=document.createElement('button');" +
                    "  camBtn.id='__ab_cam_btn';" +
                    "  camBtn.className='companion-capture-btn';" +
                    "  camBtn.textContent='\\u25C9 Cam';" +
                    "  camBtn.onclick=function(){" +
                    "    if(window.__abCamOn){" +
                    "      window.AndroidBridge.stopCameraCapture();" +
                    "      window.__abCamOn=false;window.__abCamFrame=null;" +
                    "      camBtn.textContent='\\u25C9 Cam';camBtn.classList.remove('active');" +
                    "      var th=document.getElementById('__ab_cam_thumb');if(th)th.style.display='none';" +
                    "      refreshPreview();" +
                    "    }else{" +
                    "      window.AndroidBridge.startCameraCapture();" +
                    "      window.__abCamOn=true;" +
                    "      camBtn.textContent=window.__abCamIsFront?'\\u25C9 Face':'\\u25C9 Seeing';" +
                    "      camBtn.classList.add('active');" +
                    "      refreshPreview();" +
                    "    }" +
                    "  };" +
                    "  row.insertBefore(camBtn,photoBtn.nextSibling);" +

                    "  var flipBtn=document.createElement('button');" +
                    "  flipBtn.id='__ab_flip_btn';" +
                    "  flipBtn.className='companion-capture-btn';" +
                    "  flipBtn.textContent='\\u21C4 Flip';" +
                    "  flipBtn.onclick=function(){" +
                    "    window.AndroidBridge.switchCamera();" +
                    "  };" +
                    "  row.insertBefore(flipBtn,camBtn.nextSibling);" +

                    "  window.onCameraSwitch=function(isFront){" +
                    "    window.__abCamIsFront=isFront;" +
                    "    if(window.__abCamOn){" +
                    "      camBtn.textContent=isFront?'\\u25C9 Face':'\\u25C9 Seeing';" +
                    "    }" +
                    "  };" +

                    "  window.onCameraFrame=function(b64){" +
                    "    if(!b64)return;" +
                    "    window.__abCamFrame='data:image/jpeg;base64,'+b64;" +
                    "    var th=document.getElementById('__ab_cam_thumb');" +
                    "    if(th){th.src=window.__abCamFrame;th.style.display='block';}" +
                    "  };" +

                    "  window.onPhotoFrame=function(b64){" +
                    "    if(!b64){showError('Photo capture failed');return;}" +
                    "    window.__abPhotoFrame='data:image/jpeg;base64,'+b64;" +
                    "    var th=document.getElementById('__ab_photo_thumb');" +
                    "    if(th){th.src=window.__abPhotoFrame;th.style.display='block';}" +
                    "    var btn=document.getElementById('__ab_photo_btn');" +
                    "    if(btn){btn.textContent='\\u25C9 Photo';btn.disabled=false;}" +
                    "    refreshPreview();" +
                    "  };" +

                    "  var _f=window.fetch;" +
                    "  window.fetch=function(url,opts){" +
                    "    if(typeof url==='string'&&url.includes('/api/companion')&&opts&&opts.body){" +
                    "      var frame=window.__abPhotoFrame||window.__abCamFrame;" +
                    "      if(frame){" +
                    "        try{" +
                    "          if(typeof opts.body==='string'){" +
                    "            var b=JSON.parse(opts.body);" +
                    "            b.screenshot=frame;" +
                    "            if(window.__abPhotoFrame){" +
                    "              window.__abPhotoFrame=null;" +
                    "              var pt=document.getElementById('__ab_photo_thumb');if(pt)pt.style.display='none';" +
                    "              refreshPreview();}" +
                    "            opts=Object.assign({},opts,{body:JSON.stringify(b)});" +
                    "          }" +
                    "        }catch(e){console.error('[Based Android] fetch interceptor error:',e);}" +
                    "      }" +
                    "    }" +
                    "    return _f.apply(this,arguments);" +
                    "  };" +

                    "})()", null);

                // GPS Memory Anchors
                view.evaluateJavascript(
                    "(function(){" +
                    "  window.__abLocationConsent=localStorage.getItem('based_location_consent');" +
                    "  window.__abCurrentLoc=null;" +
                    "  window.onLocationReady=function(lat,lng){" +
                    "    window.__abCurrentLoc={lat:lat,lng:lng};" +
                    "    if(window.__abLocationConsent!=='granted')return;" +
                    "    var memory=[];" +
                    "    try{memory=JSON.parse(localStorage.getItem('based_location_memory')||'[]');}catch(e){}" +
                    "    var nearest=null;var THRESHOLD=0.003;" +
                    "    for(var i=0;i<memory.length;i++){" +
                    "      var d=Math.abs(memory[i].lat-lat)+Math.abs(memory[i].lng-lng);" +
                    "      if(d<THRESHOLD&&(!nearest||d<nearest.dist))nearest={entry:memory[i],dist:d};" +
                    "    }" +
                    "    if(nearest&&nearest.entry.lastContext)window.__abLocationContext=nearest.entry.lastContext;" +
                    "  };" +
                    "  window.saveLocationContext=function(lat,lng,context){" +
                    "    if(window.__abLocationConsent!=='granted')return;" +
                    "    var memory=[];" +
                    "    try{memory=JSON.parse(localStorage.getItem('based_location_memory')||'[]');}catch(e){}" +
                    "    var THRESHOLD=0.003;var found=false;" +
                    "    for(var i=0;i<memory.length;i++){" +
                    "      var d=Math.abs(memory[i].lat-lat)+Math.abs(memory[i].lng-lng);" +
                    "      if(d<THRESHOLD){" +
                    "        memory[i].lastContext=context;" +
                    "        memory[i].visitCount=(memory[i].visitCount||0)+1;" +
                    "        memory[i].lastVisit=Date.now();" +
                    "        found=true;break;" +
                    "      }" +
                    "    }" +
                    "    if(!found)memory.push({lat:lat,lng:lng,lastContext:context,visitCount:1,lastVisit:Date.now()});" +
                    "    if(memory.length>20)memory=memory.slice(-20);" +
                    "    try{localStorage.setItem('based_location_memory',JSON.stringify(memory));}catch(e){}" +
                    "  };" +
                    "  var _gpsF=window.fetch;" +
                    "  window.fetch=function(url,opts){" +
                    "    if(typeof url==='string'&&url.includes('/api/companion')&&opts&&opts.body){" +
                    "      try{" +
                    "        if(typeof opts.body==='string'){" +
                    "          var b=JSON.parse(opts.body);" +
                    "          if(window.__abLocationContext)b.locationContext=window.__abLocationContext;" +
                    "          opts=Object.assign({},opts,{body:JSON.stringify(b)});" +
                    "        }" +
                    "      }catch(e){}" +
                    "    }" +
                    "    var result=_gpsF.apply(this,arguments);" +
                    "    if(typeof url==='string'&&url.includes('/api/companion')){" +
                    "      result.then(function(){" +
                    "        if(window.__abCurrentLoc&&window.__abLocationConsent==='granted'){" +
                    "          var bubbles=document.querySelectorAll('.companion-bubble--user');" +
                    "          var lastUserMsg=bubbles.length?bubbles[bubbles.length-1].textContent.substring(0,100):'';" +
                    "          if(lastUserMsg)window.saveLocationContext(window.__abCurrentLoc.lat,window.__abCurrentLoc.lng,lastUserMsg);" +
                    "        }" +
                    "      }).catch(function(){});" +
                    "    }" +
                    "    return result;" +
                    "  };" +
                    "  function showLocationConsentIfNeeded(){" +
                    "    if(window.__abLocationConsent!==null&&window.__abLocationConsent!==undefined&&window.__abLocationConsent!=='')return;" +
                    "    if(document.getElementById('__ab_loc_consent'))return;" +
                    "    var bar=document.createElement('div');" +
                    "    bar.id='__ab_loc_consent';" +
                    "    bar.style.cssText='position:fixed;bottom:70px;left:0;right:0;background:rgba(20,20,20,0.97);color:#e0e0e0;font-size:13px;padding:12px 16px;display:flex;align-items:center;gap:10px;z-index:99999;border-top:1px solid rgba(255,255,255,0.08);';" +
                    "    bar.innerHTML='<span style=\"flex:1\">◈ Remember where we talk?</span>'" +
                    "      +'<button id=\"__ab_loc_yes\" style=\"background:#f5c842;color:#000;border:none;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;\">Yes</button>'" +
                    "      +'<button id=\"__ab_loc_no\" style=\"background:transparent;color:#888;border:1px solid #444;padding:6px 14px;border-radius:6px;font-size:12px;cursor:pointer;\">No</button>';" +
                    "    document.body.appendChild(bar);" +
                    "    document.getElementById('__ab_loc_yes').onclick=function(){" +
                    "      localStorage.setItem('based_location_consent','granted');" +
                    "      window.__abLocationConsent='granted';" +
                    "      bar.remove();" +
                    "      if(window.__abCurrentLoc)window.onLocationReady(window.__abCurrentLoc.lat,window.__abCurrentLoc.lng);" +
                    "    };" +
                    "    document.getElementById('__ab_loc_no').onclick=function(){" +
                    "      localStorage.setItem('based_location_consent','denied');" +
                    "      window.__abLocationConsent='denied';" +
                    "      bar.remove();" +
                    "    };" +
                    "  }" +
                    "  var locConsentObs=new MutationObserver(function(){" +
                    "    if(document.querySelectorAll('.companion-bubble--user').length>=1){" +
                    "      showLocationConsentIfNeeded();locConsentObs.disconnect();" +
                    "    }" +
                    "  });" +
                    "  locConsentObs.observe(document.body,{childList:true,subtree:true});" +
                    "})()", null);

                // Proactive trigger — inject if activity was opened with PROACTIVE_CONTEXT
                if (pendingProactiveContext != null) {
                    injectProactiveTrigger(pendingProactiveContext);
                    pendingProactiveContext = null;
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

        pendingProactiveContext = getIntent().getStringExtra("PROACTIVE_CONTEXT");
        webView.loadUrl(COMPANION_URL);

        String[] permsNeeded = new java.util.ArrayList<String>() {{
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
                add(Manifest.permission.RECORD_AUDIO);
            if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
                add(Manifest.permission.CAMERA);
            if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED)
                add(Manifest.permission.ACCESS_COARSE_LOCATION);
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

        // Tapping the transparent area above the panel dismisses the companion
        root.setOnTouchListener((v, event) -> {
            if (event.getAction() == android.view.MotionEvent.ACTION_DOWN) {
                float panelTop = panel.getY();
                if (panelTop > 0 && event.getY() < panelTop) {
                    dismissSelf();
                    return true;
                }
            }
            return false;
        });

        setContentView(root);

        // Slide the panel up from off-screen on open. Pure Java animation — no CSS
        // dependency, so it works even before the WebView page finishes loading.
        panel.setTranslationY(panelHeight);
        panel.post(() -> panel.animate()
            .translationY(0f)
            .setDuration(280)
            .setInterpolator(new android.view.animation.DecelerateInterpolator(1.5f))
            .start());

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

        // Track physical device rotation via accelerometer so camera frames are
        // rotated correctly even when the Activity is portrait-locked (in which
        // case Display.getRotation() always returns 0 and can't be used).
        orientationListener = new android.view.OrientationEventListener(this) {
            @Override
            public void onOrientationChanged(int orientation) {
                if (orientation == ORIENTATION_UNKNOWN) return;
                // Round to nearest 90° and store as 0/90/180/270
                physicalOrientation = ((orientation + 45) / 90 * 90) % 360;
            }
        };
        if (orientationListener.canDetectOrientation()) orientationListener.enable();
    }

    // ── GPS Memory Anchors — one-shot last-known location fetch ─────────────────
    private void fetchLastKnownLocation() {
        if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) return;
        LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        Location loc = null;
        for (String provider : lm.getProviders(true)) {
            Location l = lm.getLastKnownLocation(provider);
            if (l != null && (loc == null || l.getAccuracy() < loc.getAccuracy())) loc = l;
        }
        if (loc == null) return;
        final double lat = Math.round(loc.getLatitude() * 1000.0) / 1000.0;
        final double lng = Math.round(loc.getLongitude() * 1000.0) / 1000.0;
        if (webView != null) {
            runOnUiThread(() -> webView.evaluateJavascript(
                "window.onLocationReady&&window.onLocationReady(" + lat + "," + lng + ")", null));
        }
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
            int targetFacing = cameraFacingFront
                ? CameraCharacteristics.LENS_FACING_FRONT
                : CameraCharacteristics.LENS_FACING_BACK;
            String targetCameraId = null;
            for (String id : manager.getCameraIdList()) {
                CameraCharacteristics ch = manager.getCameraCharacteristics(id);
                Integer facing = ch.get(CameraCharacteristics.LENS_FACING);
                if (facing != null && facing == targetFacing) {
                    targetCameraId = id;
                    Integer so = ch.get(CameraCharacteristics.SENSOR_ORIENTATION);
                    cameraSensorOrientation = so != null ? so : 90;
                    break;
                }
            }
            if (targetCameraId == null) {
                // Fall back to first available camera
                String[] ids = manager.getCameraIdList();
                if (ids.length > 0) targetCameraId = ids[0];
            }
            if (targetCameraId == null) {
                notifyCameraError("No camera found on this device");
                return;
            }

            final String cameraId = targetCameraId;
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

            // Decode, rotate, then compress at 50% quality.
            // Back:  (sO + physOri) % 360  — both compound in the same direction
            // Front: (sO - physOri + 360) % 360 — the horizontal flip reverses the physOri direction
            Bitmap raw = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (raw != null) {
                int rotation = cameraFacingFront
                    ? (cameraSensorOrientation - physicalOrientation + 360) % 360
                    : (cameraSensorOrientation + physicalOrientation) % 360;
                android.graphics.Matrix m = new android.graphics.Matrix();
                if (rotation != 0) m.postRotate(rotation);
                // Front cameras capture a mirrored image — flip horizontally to correct it
                if (cameraFacingFront) m.postScale(-1f, 1f, raw.getWidth() / 2f, raw.getHeight() / 2f);
                Bitmap bmp;
                if (!m.isIdentity()) {
                    bmp = Bitmap.createBitmap(raw, 0, 0, raw.getWidth(), raw.getHeight(), m, true);
                    raw.recycle();
                } else {
                    bmp = raw;
                }
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
        // Use the listener instead of calling processPhotoCapture() from onCaptureCompleted —
        // the image buffer may not be written yet when onCaptureCompleted fires.
        photoImageReader.setOnImageAvailableListener(reader -> processPhotoCapture(), photoHandler);

        CameraManager manager = (CameraManager) getSystemService(Context.CAMERA_SERVICE);
        try {
            String backCameraId = null;
            for (String id : manager.getCameraIdList()) {
                CameraCharacteristics ch = manager.getCameraCharacteristics(id);
                Integer facing = ch.get(CameraCharacteristics.LENS_FACING);
                if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                    backCameraId = id;
                    Integer so = ch.get(CameraCharacteristics.SENSOR_ORIENTATION);
                    photoSensorOrientation = so != null ? so : 90;
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
                                                new CameraCaptureSession.CaptureCallback() {},
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

            // Same formula as grabCameraFrame: (sensorOrientation + physicalOrientation) % 360
            Bitmap raw = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (raw != null) {
                Bitmap bmp;
                int rotation = (photoSensorOrientation + physicalOrientation) % 360;
                if (rotation != 0) {
                    android.graphics.Matrix m = new android.graphics.Matrix();
                    m.postRotate(rotation);
                    bmp = Bitmap.createBitmap(raw, 0, 0, raw.getWidth(), raw.getHeight(), m, true);
                    raw.recycle();
                } else {
                    bmp = raw;
                }
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

    private void switchCamera() {
        cameraFacingFront = !cameraFacingFront;
        boolean wasRunning = cameraRunning;
        stopCameraCapture();
        if (wasRunning) startCameraCapture();
        final boolean front = cameraFacingFront;
        if (webView != null) {
            runOnUiThread(() -> webView.evaluateJavascript(
                "window.__abCamIsFront=" + front + ";" +
                "window.onCameraSwitch&&window.onCameraSwitch(" + front + ");", null));
        }
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
        if (orientationListener != null) orientationListener.disable();
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

    private boolean isDismissing = false;

    private void dismissSelf() {
        if (isDismissing) return;
        isDismissing = true;

        // Stop screen capture cleanly when the companion is closed
        Intent stopCapture = new Intent(this, ScreenCaptureService.class);
        stopCapture.setAction(ScreenCaptureService.ACTION_STOP);
        startService(stopCapture);
        sendBroadcast(
            new Intent(ScreenCaptureService.ACTION_CAPTURE_STOPPED)
                .setPackage(getPackageName()));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            // finishAndRemoveTask() bypasses our finish() override, so send the bubble-reset broadcast first
            sendBroadcast(new Intent(ACTION_COMPANION_CLOSED).setPackage(getPackageName()));
            finishAndRemoveTask();
        } else {
            finish(); // our finish() override sends ACTION_COMPANION_CLOSED
        }
        overridePendingTransition(0, 0);
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        // User navigated away (home button, tap-outside-non-touch-modal window, etc.) — close cleanly
        if (!isFinishing()) dismissSelf();
    }

    /** Exposed to JavaScript as window.AndroidBridge */
    @SuppressWarnings("unused") // all methods called from JS via @JavascriptInterface
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

        @JavascriptInterface
        public void switchCamera() {
            runOnUiThread(() -> CompanionActivity.this.switchCamera());
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

        /**
         * Feature 7: Called from JS to update the companion name shown on the bubble.
         * Validates input (non-empty, max 20 chars), updates the static field in
         * FloatingBubbleService, and broadcasts ACTION_UPDATE_NAME so the bubble TextView
         * updates live.
         */
        @JavascriptInterface
        public void setCompanionName(String name) {
            if (name == null || name.trim().isEmpty()) return;
            String sanitised = name.trim();
            if (sanitised.length() > 20) sanitised = sanitised.substring(0, 20);
            // Update the static field directly (fast path if service is in same process)
            FloatingBubbleService.companionName = sanitised;
            // Also broadcast so the running service's TextView updates live
            Intent intent = new Intent(FloatingBubbleService.ACTION_UPDATE_NAME);
            intent.putExtra(FloatingBubbleService.EXTRA_NAME, sanitised);
            intent.setPackage(getPackageName());
            sendBroadcast(intent);
        }

        /**
         * Called from the electronAPI shim when the companion starts or stops speaking.
         * Broadcasts to FloatingBubbleService to drive lip-sync animation and speech bubble.
         */
        @JavascriptInterface
        public void setSpeaking(boolean active, String text) {
            Intent intent = new Intent(FloatingBubbleService.ACTION_BUBBLE_SPEAKING);
            intent.putExtra(FloatingBubbleService.EXTRA_SPEAKING_ACTIVE, active);
            intent.putExtra(FloatingBubbleService.EXTRA_SPEAKING_TEXT, text != null ? text : "");
            intent.setPackage(getPackageName());
            sendBroadcast(intent);
            // While TTS is playing, mute the SpeechRecognition so the mic can't
            // pick up Based's own voice and trigger a second overlapping response.
            if (webView != null) {
                final String js = active
                    ? "window.__abSpeakingActive=true;" +
                      "if(window.__abActiveSR){try{window.__abActiveSR.abort();}catch(e){}window.__abActiveSR=null;}"
                    : "window.__abSpeakingActive=false;";
                runOnUiThread(() -> webView.evaluateJavascript(js, null));
            }
        }

        /**
         * Share text via Android's native share sheet.
         * Used by the shareable card feature — JS side calls window.AndroidBridge.shareText(text).
         */
        @JavascriptInterface
        public void shareText(String text) {
            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType("text/plain");
            shareIntent.putExtra(Intent.EXTRA_TEXT, text);
            runOnUiThread(() -> startActivity(Intent.createChooser(shareIntent, "Share via")));
        }
    }

    private int dpToPx(int dp) {
        return Math.round(dp * getResources().getDisplayMetrics().density);
    }
}
