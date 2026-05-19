// PWA install banner — Android: native prompt, iOS: instructions modal.
// Dismissible; reappears after 7 days. Hidden when already installed.
(function () {
  'use strict';

  const DISMISS_KEY = 'installBannerDismissedAt';
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  let deferredPrompt = null;
  let bannerShown = false;

  function track(name, props) {
    try {
      if (typeof window.plausible === 'function') window.plausible(name, { props: props || {} });
    } catch (_) {}
  }

  // Capture install prompt on Android/desktop Chromium (stash it for later trigger)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

  // After install, hide banner forever-ish
  window.addEventListener('appinstalled', () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + 365 * 24 * 60 * 60 * 1000));
    hideBanner();
    track('pwa_installed');
  });

  function canShowNow() {
    // Already installed → never show
    if (isStandalone) return false;
    // Already showing this session → don't double-show
    if (bannerShown) return false;
    // Dismissed in the last 7 days → skip
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
    if (dismissedAt && Date.now() - dismissedAt < SEVEN_DAYS) return false;
    // Need either a captured prompt (Android) or iOS Safari
    if (!deferredPrompt && !isIOS) return false;
    return true;
  }

  // Public trigger — call after a meaningful success moment (e.g. end of lesson)
  window.showInstallBanner = function () {
    if (!canShowNow()) return false;
    showBanner();
    return true;
  };

  function showBanner() {
    const banner = document.getElementById('install-banner');
    if (!banner) return;
    banner.classList.remove('hidden');
    requestAnimationFrame(() => banner.classList.add('visible'));
    bannerShown = true;
    track('install_banner_shown', { platform: isIOS ? 'ios' : 'android' });
  }

  function hideBanner() {
    const banner = document.getElementById('install-banner');
    if (!banner) return;
    banner.classList.remove('visible');
    setTimeout(() => banner.classList.add('hidden'), 250);
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    hideBanner();
    track('install_banner_dismissed', { platform: isIOS ? 'ios' : 'android' });
  }

  function showIOSModal() {
    const modal = document.getElementById('ios-install-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    requestAnimationFrame(() => modal.classList.add('visible'));
    track('install_ios_modal_shown');
  }

  function hideIOSModal() {
    const modal = document.getElementById('ios-install-modal');
    if (!modal) return;
    modal.classList.remove('visible');
    setTimeout(() => modal.classList.add('hidden'), 200);
  }

  async function handleInstallClick() {
    if (isIOS) {
      showIOSModal();
      return;
    }
    if (!deferredPrompt) return;
    track('install_prompt_clicked');
    deferredPrompt.prompt();
    try {
      const { outcome } = await deferredPrompt.userChoice;
      track('install_prompt_outcome', { outcome });
      if (outcome === 'accepted') {
        hideBanner();
      } else {
        // User said "later" — treat as dismiss for 7 days
        dismiss();
      }
    } catch (_) {}
    deferredPrompt = null;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const installBtn = document.getElementById('install-btn');
    const dismissBtn = document.getElementById('install-dismiss');
    const iosClose = document.getElementById('ios-install-close');
    const iosBackdrop = document.querySelector('.ios-install-backdrop');

    if (installBtn) installBtn.addEventListener('click', handleInstallClick);
    if (dismissBtn) dismissBtn.addEventListener('click', dismiss);
    if (iosClose) iosClose.addEventListener('click', hideIOSModal);
    if (iosBackdrop) iosBackdrop.addEventListener('click', hideIOSModal);
  });
})();
