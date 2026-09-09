package com.creepyside11.portside;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;
import java.io.ByteArrayInputStream;

/** Runs the bundled game offline on a local HTTPS origin with hardware WebGL. */
public final class MainActivity extends Activity {
    private WebView game;
    private static final String ORIGIN = "https://appassets.androidplatform.net/";

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        game = new WebView(this);
        game.setBackgroundColor(0xff152c2b);
        setContentView(game);
        WebSettings settings = game.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportZoom(false);
        game.setWebChromeClient(new WebChromeClient());
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        game.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse local = loader.shouldInterceptRequest(request.getUrl());
                if (local != null) return local;
                // The APK is self-contained; never fall back to a network request.
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not found", null,
                        new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !request.getUrl().toString().equals(ORIGIN + "index.html");
            }
        });
        game.loadUrl(ORIGIN + "index.html");
        immersive();
    }

    private void pauseGame() {
        if (game != null) game.evaluateJavascript("window.dispatchEvent(new Event('blur'));", null);
    }
    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }
    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused) immersive(); else pauseGame();
    }
    @Override protected void onPause() {
        pauseGame();
        if (game != null) { game.onPause(); game.pauseTimers(); }
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (game != null) { game.resumeTimers(); game.onResume(); }
        immersive();
    }
    @Override public void onBackPressed() {
        pauseGame();
        new AlertDialog.Builder(this).setTitle("Выйти из Portside?")
                .setMessage("Текущая игровая сессия не сохраняется.")
                .setPositiveButton("Выйти", (dialog, which) -> finish())
                .setNegativeButton("Продолжить", (dialog, which) -> immersive()).show();
    }
    @Override protected void onDestroy() {
        if (game != null) { game.stopLoading(); game.destroy(); game = null; }
        super.onDestroy();
    }
}
