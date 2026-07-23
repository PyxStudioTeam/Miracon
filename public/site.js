document.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('js-enabled');

  /* ==========================================================================
     HOME HERO VIDEO PLAYLIST
     ========================================================================== */
  const homeHeroPlaylist = document.querySelector('[data-home-hero-playlist]');
  const homeHeroVideoSlots = homeHeroPlaylist
    ? Array.from(homeHeroPlaylist.querySelectorAll('.hero-video'))
    : [];

  if (homeHeroPlaylist && homeHeroVideoSlots.length === 2) {
    let playlist = [];
    try {
      playlist = JSON.parse(homeHeroPlaylist.dataset.homeHeroPlaylist || '[]');
    } catch {
      playlist = [];
    }

    if (playlist.length) {
      const mobileMedia = window.matchMedia('(max-width: 600px)');
      let currentIndex = 0;
      let activeSlotIndex = 0;
      let switching = false;
      let failedAdvances = 0;

      function videoUrl(item) {
        return mobileMedia.matches && item.mobileUrl ? item.mobileUrl : item.desktopUrl;
      }

      function loadSlot(video, item, preload = 'metadata') {
        const nextUrl = videoUrl(item);
        if (!nextUrl || video.dataset.playlistSrc === nextUrl) return;
        video.pause();
        video.preload = preload;
        video.src = nextUrl;
        video.dataset.playlistSrc = nextUrl;
        video.load();
      }

      function primeNextSlot() {
        const activeVideo = homeHeroVideoSlots[activeSlotIndex];
        activeVideo.loop = playlist.length === 1;
        if (playlist.length === 1) return;

        const nextIndex = (currentIndex + 1) % playlist.length;
        const standbyVideo = homeHeroVideoSlots[1 - activeSlotIndex];
        standbyVideo.loop = false;
        loadSlot(standbyVideo, playlist[nextIndex], 'metadata');
      }

      function advancePlaylist() {
        if (switching || playlist.length < 2) return;
        switching = true;

        const outgoingVideo = homeHeroVideoSlots[activeSlotIndex];
        const incomingSlotIndex = 1 - activeSlotIndex;
        const incomingVideo = homeHeroVideoSlots[incomingSlotIndex];
        const nextIndex = (currentIndex + 1) % playlist.length;
        loadSlot(incomingVideo, playlist[nextIndex], 'auto');
        incomingVideo.currentTime = 0;
        incomingVideo.muted = true;

        const playPromise = incomingVideo.play();
        Promise.resolve(playPromise).then(() => {
          failedAdvances = 0;
          incomingVideo.classList.add('is-active');
          outgoingVideo.classList.remove('is-active');

          window.setTimeout(() => {
            outgoingVideo.pause();
            activeSlotIndex = incomingSlotIndex;
            currentIndex = nextIndex;
            switching = false;
            primeNextSlot();
          }, 680);
        }).catch(() => {
          switching = false;
          failedAdvances += 1;
          currentIndex = nextIndex;
          if (failedAdvances < playlist.length) {
            advancePlaylist();
          } else {
            outgoingVideo.loop = true;
            outgoingVideo.play().catch(() => {});
          }
        });
      }

      function reloadForViewport() {
        const activeVideo = homeHeroVideoSlots[activeSlotIndex];
        const standbyVideo = homeHeroVideoSlots[1 - activeSlotIndex];
        standbyVideo.classList.remove('is-active');
        loadSlot(activeVideo, playlist[currentIndex], 'auto');
        activeVideo.classList.add('is-active');
        activeVideo.muted = true;
        activeVideo.play().catch(() => {});
        primeNextSlot();
      }

      homeHeroVideoSlots.forEach((video) => {
        video.addEventListener('ended', () => {
          if (video.classList.contains('is-active')) advancePlaylist();
        });
      });

      const initialVideo = homeHeroVideoSlots[activeSlotIndex];
      initialVideo.dataset.playlistSrc = initialVideo.currentSrc || videoUrl(playlist[0]);
      initialVideo.loop = playlist.length === 1;
      initialVideo.muted = true;
      initialVideo.play().catch(() => {});
      primeNextSlot();
      mobileMedia.addEventListener('change', reloadForViewport);
    }
  }

  /* ==========================================================================
     HERO SCROLL
     ========================================================================== */
  const pageHeader = document.querySelector('.header');
  const heroPin = document.querySelector('.hero-pin');
  const sectionAfterHero = heroPin?.nextElementSibling;

  if (heroPin) {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let heroScrollTicking = false;

    function updateHeroScroll() {
      const rect = heroPin.getBoundingClientRect();
      const heroDistance = Math.max(heroPin.offsetHeight, 1);
      const scrollOffset = Math.max(-rect.top, 0);
      const heroOverlapGap = sectionAfterHero
        ? parseFloat(window.getComputedStyle(sectionAfterHero).paddingTop) || 0
        : 0;
      const progress = Math.min(Math.max(-rect.top / heroDistance, 0), 1);

      if (!prefersReducedMotion) {
        heroPin.style.setProperty('--hero-video-scale', (1.035 - progress * 0.025).toFixed(4));
        heroPin.style.setProperty('--hero-content-y', `${Math.round(progress * -92)}px`);
        heroPin.style.setProperty('--hero-content-opacity', Math.max(1 - progress * 0.72, 0.28).toFixed(3));
      }

      heroPin.style.setProperty('--hero-scroll-opacity', Math.max(1 - progress * 3.2, 0).toFixed(3));
      heroPin.style.setProperty(
        '--hero-layer-opacity',
        scrollOffset <= heroDistance + heroOverlapGap + 1 ? '1' : '0'
      );

      if (pageHeader) {
        pageHeader.classList.toggle('header--hidden', progress > 0.035 || window.scrollY > 48);
      }

      heroScrollTicking = false;
    }

    function requestHeroScrollUpdate() {
      if (heroScrollTicking) {
        return;
      }

      heroScrollTicking = true;
      window.requestAnimationFrame(updateHeroScroll);
    }

    updateHeroScroll();
    window.addEventListener('scroll', requestHeroScrollUpdate, { passive: true });
    window.addEventListener('resize', requestHeroScrollUpdate);
  }

  /* ==========================================================================
     PROJECT VIDEO DECKS
     ========================================================================== */
  function createProjectVideoDeck(deck, { lazy = false, onSoundChange } = {}) {
    const slots = Array.from(deck.querySelectorAll('.project-video-slot'));
    const deckKind = deck.dataset.projectVideoDeck;
    const reducedPlayButton = deck.querySelector('.project-video-reduced-play')
      || deck.parentElement?.querySelector(`[data-video-control-for="${deckKind}"]`);
    let playlist = [];
    try {
      playlist = JSON.parse(deck.dataset.videoPlaylist || '[]').filter(item => item?.desktopUrl);
    } catch {
      playlist = [];
    }
    if (slots.length !== 2 || !playlist.length) return null;

    const mobileMedia = window.matchMedia('(max-width: 760px)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const failedItems = new Set();
    let currentIndex = 0;
    let activeSlotIndex = 0;
    let switching = false;
    let soundOn = false;
    let inView = !lazy;
    let operation = 0;
    let pendingIndex = -1;
    let manualReducedPlayback = false;

    function videoUrl(item) {
      return mobileMedia.matches && item.mobileUrl ? item.mobileUrl : item.desktopUrl;
    }

    function loadSlot(video, item, preload = 'metadata') {
      const nextUrl = videoUrl(item);
      if (!nextUrl || video.dataset.playlistSrc === nextUrl) return;
      video.pause();
      video.preload = preload;
      video.poster = item.posterUrl || '';
      video.src = nextUrl;
      video.dataset.playlistSrc = nextUrl;
      video.load();
    }

    function activeVideo() {
      return slots[activeSlotIndex];
    }

    function syncSound() {
      slots.forEach((video, index) => {
        video.muted = !soundOn || index !== activeSlotIndex;
        video.volume = 1;
      });
      onSoundChange?.(soundOn);
    }

    function syncReducedPlayButton() {
      if (!reducedPlayButton) return;
      const isPlaying = manualReducedPlayback && !activeVideo().paused;
      reducedPlayButton.textContent = isPlaying ? 'Pause video' : 'Play video';
      reducedPlayButton.setAttribute('aria-label', isPlaying ? 'Pause video' : 'Play video');
    }

    function findNextIndex() {
      for (let offset = 1; offset <= playlist.length; offset += 1) {
        const index = (currentIndex + offset) % playlist.length;
        if (!failedItems.has(index)) return index;
      }
      return -1;
    }

    function primeNextSlot() {
      const currentVideo = activeVideo();
      currentVideo.loop = playlist.length === 1;
      if (playlist.length === 1 || reducedMotion.matches) return;
      const nextIndex = findNextIndex();
      if (nextIndex < 0 || nextIndex === currentIndex) return;
      const standby = slots[1 - activeSlotIndex];
      standby.loop = false;
      standby.muted = true;
      loadSlot(standby, playlist[nextIndex], 'metadata');
    }

    function resumeActive() {
      if (!inView || document.hidden || (reducedMotion.matches && !manualReducedPlayback)) return;
      const video = activeVideo();
      video.muted = !soundOn;
      video.play().catch(() => {
        soundOn = false;
        video.muted = true;
        onSoundChange?.(false);
      }).finally(syncReducedPlayButton);
    }

    function advancePlaylist() {
      if (switching || playlist.length < 2 || reducedMotion.matches || document.hidden || !inView) return;
      const nextIndex = findNextIndex();
      if (nextIndex < 0 || nextIndex === currentIndex) {
        activeVideo().loop = true;
        return;
      }

      switching = true;
      const token = ++operation;
      const outgoing = activeVideo();
      const incomingSlotIndex = 1 - activeSlotIndex;
      const incoming = slots[incomingSlotIndex];
      pendingIndex = nextIndex;
      loadSlot(incoming, playlist[nextIndex], 'auto');
      incoming.currentTime = 0;
      incoming.loop = false;
      incoming.muted = true;

      Promise.resolve(incoming.play()).then(() => {
        if (token !== operation) return;
        incoming.classList.add('is-incoming');
        window.setTimeout(() => {
          if (token !== operation) return;
          outgoing.classList.remove('is-active');
          outgoing.pause();
          outgoing.currentTime = 0;
          incoming.classList.remove('is-incoming');
          incoming.classList.add('is-active');
          activeSlotIndex = incomingSlotIndex;
          currentIndex = nextIndex;
          pendingIndex = -1;
          switching = false;
          syncSound();
          primeNextSlot();
        }, 700);
      }).catch(() => {
        if (token !== operation) return;
        failedItems.add(nextIndex);
        pendingIndex = -1;
        switching = false;
        advancePlaylist();
      });
    }

    function advanceReducedPlaylist() {
      if (!manualReducedPlayback || playlist.length < 2) {
        manualReducedPlayback = false;
        syncReducedPlayButton();
        return;
      }
      const nextIndex = findNextIndex();
      if (nextIndex < 0 || nextIndex === currentIndex) {
        manualReducedPlayback = false;
        syncReducedPlayButton();
        return;
      }
      currentIndex = nextIndex;
      const video = activeVideo();
      loadSlot(video, playlist[currentIndex], 'auto');
      video.currentTime = 0;
      video.muted = true;
      resumeActive();
    }

    function resetForEnvironment() {
      operation += 1;
      switching = false;
      pendingIndex = -1;
      manualReducedPlayback = false;
      if (reducedMotion.matches) soundOn = false;
      failedItems.clear();
      slots.forEach((video, index) => {
        video.pause();
        video.classList.toggle('is-active', index === activeSlotIndex);
        video.classList.remove('is-incoming');
      });
      loadSlot(activeVideo(), playlist[currentIndex], 'auto');
      syncSound();
      syncReducedPlayButton();
      resumeActive();
      primeNextSlot();
    }

    slots.forEach((video) => {
      video.addEventListener('timeupdate', () => {
        if (video !== activeVideo() || !Number.isFinite(video.duration)) return;
        if (video.duration - video.currentTime <= 0.74) advancePlaylist();
      });
      video.addEventListener('ended', () => {
        if (video !== activeVideo()) return;
        if (reducedMotion.matches) {
          advanceReducedPlaylist();
        } else {
          advancePlaylist();
        }
      });
      video.addEventListener('error', () => {
        if (switching && video !== activeVideo() && pendingIndex >= 0) {
          operation += 1;
          failedItems.add(pendingIndex);
          pendingIndex = -1;
          switching = false;
          video.classList.remove('is-incoming');
          video.pause();
          advancePlaylist();
          return;
        }
        if (video !== activeVideo() || playlist.length < 2) return;
        failedItems.add(currentIndex);
        switching = false;
        if (reducedMotion.matches) advanceReducedPlaylist();
        else advancePlaylist();
      });
    });

    const initialVideo = activeVideo();
    initialVideo.dataset.playlistSrc = initialVideo.currentSrc || videoUrl(playlist[0]);
    initialVideo.loop = playlist.length === 1;
    initialVideo.muted = true;
    if (reducedMotion.matches || !inView) initialVideo.pause();
    else resumeActive();
    syncReducedPlayButton();
    primeNextSlot();

    reducedPlayButton?.addEventListener('click', () => {
      const video = activeVideo();
      if (!video.paused) {
        video.pause();
        manualReducedPlayback = false;
        syncReducedPlayButton();
        return;
      }
      manualReducedPlayback = true;
      video.muted = true;
      if (video.ended) video.currentTime = 0;
      resumeActive();
    });

    mobileMedia.addEventListener('change', resetForEnvironment);
    reducedMotion.addEventListener('change', resetForEnvironment);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        slots.forEach(video => video.pause());
        syncReducedPlayButton();
      } else resumeActive();
    });

    if (lazy && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver(([entry]) => {
        inView = entry.isIntersecting;
        if (inView) resumeActive();
        else {
          slots.forEach(video => video.pause());
          syncReducedPlayButton();
        }
      }, { threshold: 0.12 });
      observer.observe(deck);
    } else if (lazy) {
      inView = true;
      resumeActive();
    }

    return {
      toggleSound() {
        soundOn = !soundOn;
        syncSound();
        resumeActive();
      },
      isSoundOn() {
        return soundOn;
      },
    };
  }

  const projectHero = document.querySelector('.project-hero[data-project-hero]');
  const projectHeroDeck = projectHero?.querySelector('[data-project-video-deck="hero"]');
  const projectHeroSoundButton = projectHero?.querySelector('.project-hero-sound-button');
  let projectHeroController = null;

  function syncHeroSoundButton(isSoundOn = projectHeroController?.isSoundOn() || false) {
    if (!projectHeroSoundButton) return;
    const soundText = projectHeroSoundButton.querySelector('.project-hero-sound-text');
    projectHeroSoundButton.classList.toggle('is-sound-on', isSoundOn);
    projectHeroSoundButton.setAttribute('aria-pressed', String(isSoundOn));
    projectHeroSoundButton.setAttribute('aria-label', isSoundOn ? 'Mute video sound' : 'Enable video sound');
    if (soundText) soundText.textContent = isSoundOn ? 'Mute' : 'Sound';
  }

  if (projectHeroDeck) {
    projectHeroController = createProjectVideoDeck(projectHeroDeck, { onSoundChange: syncHeroSoundButton });
  }

  if (projectHero && projectHeroDeck) {
    const heroIdleDelay = 1800;
    const shouldIdleUi = projectHero.dataset.idleUi === 'true';
    let heroIdleTimeout;

    function setHeroIdle() {
      if (shouldIdleUi) projectHero.classList.add('is-hero-idle');
    }

    function wakeHero() {
      projectHero.classList.remove('is-hero-idle');
      window.clearTimeout(heroIdleTimeout);
      heroIdleTimeout = window.setTimeout(setHeroIdle, heroIdleDelay);
    }

    if (shouldIdleUi) {
      projectHero.addEventListener('pointerenter', wakeHero);
      projectHero.addEventListener('pointermove', wakeHero);
      projectHero.addEventListener('focusin', wakeHero);
      projectHero.addEventListener('touchstart', wakeHero, { passive: true });
      projectHero.addEventListener('pointerleave', () => {
        window.clearTimeout(heroIdleTimeout);
        heroIdleTimeout = window.setTimeout(setHeroIdle, heroIdleDelay);
      });
      wakeHero();
    }

    if (projectHeroSoundButton && projectHeroController) {
      projectHeroSoundButton.addEventListener('click', (event) => {
        event.stopPropagation();
        projectHeroController.toggleSound();
      });
    }
    syncHeroSoundButton();
  }

  document.querySelectorAll('[data-project-video-deck="walkthrough"]').forEach((deck) => {
    createProjectVideoDeck(deck, { lazy: true });
  });

  /* ==========================================================================
     MOBILE NAVIGATION MENU
     ========================================================================== */
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const mobileNav = document.getElementById('mobileNav');
  const mobileNavLinks = document.querySelectorAll('.mobile-nav-link');
  const mobileContactButton = document.querySelector('.mobile-nav-contact');
  const mobileContactDetails = document.getElementById('mobileContactDetails');

  if (mobileMenuBtn && mobileNav) {
    const menuFocusableElements = () => Array.from(mobileNav.querySelectorAll(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(element => !element.closest('.mobile-nav-contacts') || mobileContactDetails?.classList.contains('active'));

    const setMenuOpen = (isOpen, shouldFocusMenu = false) => {
      mobileNav.classList.toggle('active', isOpen);
      mobileMenuBtn.classList.toggle('active', isOpen);
      mobileMenuBtn.setAttribute('aria-expanded', String(isOpen));
      mobileMenuBtn.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
      mobileNav.setAttribute('aria-hidden', String(!isOpen));
      if (!isOpen && mobileContactButton && mobileContactDetails) {
        mobileContactButton.setAttribute('aria-expanded', 'false');
        mobileContactDetails.classList.remove('active');
        mobileContactDetails.setAttribute('aria-hidden', 'true');
      }
      if (isOpen && shouldFocusMenu) menuFocusableElements()[0]?.focus();
    };

    mobileNav.setAttribute('aria-hidden', 'true');
    if (mobileContactDetails) mobileContactDetails.setAttribute('aria-hidden', 'true');

    mobileMenuBtn.addEventListener('click', () => {
      setMenuOpen(!mobileNav.classList.contains('active'), true);
    });

    mobileNavLinks.forEach(link => {
      link.addEventListener('click', () => {
        setMenuOpen(false);
      });
    });

    if (mobileContactButton && mobileContactDetails) {
      mobileContactButton.addEventListener('click', () => {
        const isOpen = mobileContactDetails.classList.toggle('active');
        mobileContactButton.setAttribute('aria-expanded', String(isOpen));
        mobileContactDetails.setAttribute('aria-hidden', String(!isOpen));
      });

      mobileContactDetails.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
          setMenuOpen(false);
        });
      });
    }

    document.addEventListener('keydown', event => {
      if (!mobileNav.classList.contains('active')) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
        mobileMenuBtn.focus();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusableElements = menuFocusableElements();
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (!firstElement || !lastElement) return;
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    });
  }

  /* ==========================================================================
     PROJECTS FILTER FUNCTIONALITY
     ========================================================================== */
  const filterTabs = document.querySelectorAll('.filter-tab');
  const projectCards = document.querySelectorAll('.project-card');

  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.classList.contains('active')) {
        return;
      }

      // Keep the visual state and the control's accessible state in sync.
      filterTabs.forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-pressed', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-pressed', 'true');

      const filterValue = tab.getAttribute('data-filter');

      // Filter cards
      projectCards.forEach(card => {
        const categories = card.getAttribute('data-category').split(' ');

        if (filterValue === 'all' || categories.includes(filterValue)) {
          card.style.display = window.matchMedia('(max-width: 600px)').matches ? 'flex' : 'grid';
          card.style.opacity = '1';
          card.style.transform = 'translateY(100px)';
          card.style.clipPath = 'inset(-20px -20px 100px -20px)';
          setTimeout(() => {
            card.style.transition = 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1), clip-path 0.5s cubic-bezier(0.25, 1, 0.5, 1)';
            card.style.transform = 'translateY(0)';
            card.style.clipPath = 'inset(-20px -20px -20px -20px)';
          }, 50);
        } else {
          card.style.display = 'none';
          card.style.opacity = '';
          card.style.transform = '';
          card.style.clipPath = '';
          card.style.transition = '';
        }
      });
    });
  });

  /* ==========================================================================
     SCROLL REVEAL ANIMATIONS
     ========================================================================== */
  const revealObserver = new IntersectionObserver((entries, observer) => {
    // Stagger project cards that enter viewport simultaneously
    let cardIndex = 0;
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        if (entry.target.classList.contains('project-card')) {
          entry.target.style.transitionDelay = `${cardIndex * 0.15}s`;
          cardIndex++;
        }
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.15,
    rootMargin: '0px 0px -50px 0px'
  });

  projectCards.forEach(card => {
    revealObserver.observe(card);
  });

  // About section scroll reveal
  const aboutRevealElements = document.querySelectorAll('.about-reveal');
  aboutRevealElements.forEach(el => {
    revealObserver.observe(el);
  });

  /* ========================================================================
     MOBILE SEQUENTIAL CARD REVEALS
     ======================================================================== */
  const mobileLayout = window.matchMedia('(max-width: 600px)');
  const mobileRiseGroups = [
    document.querySelector('.about-carousel-set'),
    document.querySelector('.stages-carousel-set')
  ].filter(Boolean);

  if (mobileLayout.matches && mobileRiseGroups.length > 0) {
    const reduceMobileMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    mobileRiseGroups.forEach(group => {
      Array.from(group.children).forEach((card, index) => {
        card.classList.add('mobile-rise-card');
        card.style.transitionDelay = `${index * 110}ms`;
      });
    });

    if (reduceMobileMotion || !('IntersectionObserver' in window)) {
      mobileRiseGroups.forEach(group => {
        Array.from(group.children).forEach(card => card.classList.add('mobile-rise-card--visible'));
      });
    } else {
      const mobileRiseObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;

          Array.from(entry.target.children).forEach(card => {
            card.classList.add('mobile-rise-card--visible');
          });
          mobileRiseObserver.unobserve(entry.target);
        });
      }, {
        threshold: .12,
        rootMargin: '0px 0px -8% 0px'
      });

      mobileRiseGroups.forEach(group => mobileRiseObserver.observe(group));
    }
  }

  const projectRevealElements = document.querySelectorAll(`
    .project-page .project-intro-media .project-section-title,
    .project-page .project-intro-image,
    .project-page .project-intro-copy,
    .project-page .project-amenities-heading,
    .project-page .project-amenity-card,
    .project-page .project-plan-card
  `);

  projectRevealElements.forEach(el => {
    revealObserver.observe(el);
  });

  /* ==========================================================================
     GOLDEN VISA CAROUSEL / SLIDER
     ========================================================================== */
  const slides = document.querySelectorAll('.slider-slides .slide');
  const counterElement = document.querySelector('.slider-counter');
  const btnPrev = document.querySelector('.btn-prev');
  const btnNext = document.querySelector('.btn-next');
  const goldenFaces = document.querySelectorAll('.golden-carousel-face');
  let currentSlideIndex = 0;

  if (slides.length > 0 && counterElement && btnPrev && btnNext) {

    function updateSlider() {
      // Update slide visibility
      slides.forEach((slide, index) => {
        if (index === currentSlideIndex) {
          slide.classList.add('active');
        } else {
          slide.classList.remove('active');
        }
      });

      // Update counter text (e.g. "1/4")
      counterElement.textContent = `${currentSlideIndex + 1}/${slides.length}`;

      // Sync coverflow image carousel
      if (goldenFaces.length > 0) {
        goldenFaces.forEach((face, i) => {
          const relPos = (i - currentSlideIndex + goldenFaces.length) % goldenFaces.length;
          face.setAttribute('data-pos', relPos);
        });
      }

      // Animate consult/details button on slide change
      const consultBadge = document.querySelector('.visa-consult-badge');
      if (consultBadge) {
        consultBadge.classList.remove('animate');
        void consultBadge.offsetWidth; // trigger reflow
        consultBadge.classList.add('animate');
      }
    }

    btnPrev.addEventListener('click', () => {
      if (currentSlideIndex > 0) {
        currentSlideIndex--;
      } else {
        currentSlideIndex = slides.length - 1; // loop back
      }
      updateSlider();
    });

    btnNext.addEventListener('click', () => {
      if (currentSlideIndex < slides.length - 1) {
        currentSlideIndex++;
      } else {
        currentSlideIndex = 0; // loop back
      }
      updateSlider();
    });

    // Initialize slider
    updateSlider();
  }

  /* ==========================================================================
     PROJECT GALLERY SLIDER
     ========================================================================== */
  document.querySelectorAll('img[data-fallback-src]').forEach(image => {
    image.addEventListener('error', () => {
      const fallbackSrc = image.dataset.fallbackSrc;
      if (fallbackSrc && image.getAttribute('src') !== fallbackSrc) {
        image.removeAttribute('srcset');
        image.src = fallbackSrc;
      }
    });
  });

  const gallerySlots = [
    { element: document.querySelector('.project-gallery-image--far-left'), offset: -2 },
    { element: document.querySelector('.project-gallery-image--left'), offset: -1 },
    { element: document.querySelector('.project-gallery-image--main'), offset: 0 },
    { element: document.querySelector('.project-gallery-image--right-small'), offset: 1 }
  ];
  const galleryImages = gallerySlots.map(slot => slot.element).filter(Boolean);

  if (galleryImages.length === gallerySlots.length) {
    const gallerySlides = [];
    const gallerySlideKeys = new Set();
    const gallerySourceImages = Array.from(document.querySelectorAll(
      '.project-gallery-track img, .project-gallery-source[data-src]'
    ));

    gallerySourceImages.forEach(image => {
      const src = image.getAttribute('data-src') || image.getAttribute('src');
      const key = new URL(src, window.location.href).href;

      if (!gallerySlideKeys.has(key)) {
        gallerySlideKeys.add(key);
        gallerySlides.push({
          src,
          srcset: image.getAttribute('data-srcset') || image.getAttribute('srcset') || '',
          fallbackSrc: image.getAttribute('data-fallback-src') || '',
          alt: image.getAttribute('data-alt') || image.getAttribute('alt') || '',
          focalX: Number(image.getAttribute('data-focal-x') || 50),
          focalY: Number(image.getAttribute('data-focal-y') || 50)
        });
      }
    });

    if (gallerySlides.length > 1) {
      const mainImage = document.querySelector('.project-gallery-image--main');
      const mainKey = new URL(mainImage.getAttribute('src'), window.location.href).href;
      const initialMainIndex = gallerySlides.findIndex(slide => (
        new URL(slide.src, window.location.href).href === mainKey
      ));
      let currentGalleryIndex = initialMainIndex >= 0 ? initialMainIndex : 0;
      const galleryStrip = document.querySelector('.project-gallery-strip');
      const galleryPreviousButton = galleryStrip?.querySelector('.project-gallery-arrow--previous');
      const galleryNextButton = galleryStrip?.querySelector('.project-gallery-arrow--next');

      function getGallerySlide(offset) {
        const slideIndex = (currentGalleryIndex + offset + gallerySlides.length) % gallerySlides.length;
        return gallerySlides[slideIndex];
      }

      function renderGallerySlide(animate = true) {
        const updateImages = () => {
          gallerySlots.forEach(slot => {
            const slide = getGallerySlide(slot.offset);
            if (slide.fallbackSrc) {
              slot.element.dataset.fallbackSrc = slide.fallbackSrc;
            } else {
              delete slot.element.dataset.fallbackSrc;
            }
            if (slide.srcset) {
              slot.element.srcset = slide.srcset;
            } else {
              slot.element.removeAttribute('srcset');
            }
            slot.element.src = slide.src;
            slot.element.alt = slide.alt;
            slot.element.style.objectPosition = `${slide.focalX}% ${slide.focalY}%`;
          });
        };

        if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          updateImages();
          return;
        }

        galleryImages.forEach(image => image.classList.add('project-gallery-image--is-changing'));
        window.setTimeout(() => {
          updateImages();
          window.requestAnimationFrame(() => {
            galleryImages.forEach(image => image.classList.remove('project-gallery-image--is-changing'));
          });
        }, 360);
      }

      function moveGallery(direction, animate = true) {
        currentGalleryIndex = (currentGalleryIndex + direction + gallerySlides.length) % gallerySlides.length;
        renderGallerySlide(animate);
      }

      galleryPreviousButton?.addEventListener('click', () => {
        moveGallery(-1);
      });
      galleryNextButton?.addEventListener('click', () => {
        moveGallery(1);
      });
    }
  }

  /* ==========================================================================
     CONSULTATION FORM SUBMISSION
     ========================================================================== */
  const consultationForms = document.querySelectorAll('[data-consultation-form]');

  consultationForms.forEach((consultationForm) => {
    const consent = consultationForm.querySelector('[name="consent"]');
    const submitBtn = consultationForm.querySelector('.btn-submit');
    const status = consultationForm.querySelector('.form-status');
    const web3FormsKey = consultationForm.dataset.web3formsKey;
    const formStartedAt = Date.now();
    const attemptStorageKey = 'miracon-contact-last-attempt';
    const successStorageKey = 'miracon-contact-last-success';

    const storedTimestamp = (storage, key) => {
      try {
        return Number(storage.getItem(key) || 0);
      } catch {
        return 0;
      }
    };

    const storeTimestamp = (storage, key, value) => {
      try {
        storage.setItem(key, String(value));
      } catch {
        // Storage can be unavailable in strict privacy modes.
      }
    };

    const setStatus = (message, type) => {
      if (!status) return;
      status.textContent = message;
      status.hidden = false;
      status.dataset.status = type;
    };

    const updateSubmitState = () => {
      if (submitBtn && consent) submitBtn.disabled = !consent.checked;
    };

    updateSubmitState();
    if (consent) consent.addEventListener('change', updateSubmitState);

    consultationForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(consultationForm);
      const name = String(formData.get('name') || '').trim();
      const phone = String(formData.get('phone') || '').trim();
      const email = String(formData.get('email') || '').trim();
      const captchaResponse = String(formData.get('h-captcha-response') || '').trim();
      const emailInput = consultationForm.querySelector('[name="email"]');
      const now = Date.now();

      if (!name || (!phone && !email)) {
        setStatus('Please enter your name and at least one contact detail.', 'error');
        return;
      }

      if (email && emailInput && !emailInput.checkValidity()) {
        setStatus('Please enter a valid email address.', 'error');
        return;
      }

      if (formData.get('botcheck')) {
        setStatus('Unable to send your request. Please try again.', 'error');
        return;
      }

      if (!captchaResponse) {
        setStatus('Please complete the security check.', 'error');
        return;
      }

      if (now - formStartedAt < 1500) {
        setStatus('Please wait a moment and try again.', 'error');
        return;
      }

      const lastAttempt = storedTimestamp(sessionStorage, attemptStorageKey);
      const lastSuccess = storedTimestamp(localStorage, successStorageKey);
      if (now - lastAttempt < 15000 || now - lastSuccess < 60000) {
        setStatus('Please wait before sending another request.', 'error');
        return;
      }

      submitBtn.disabled = true;
      setStatus('Sending your request...', 'pending');
      storeTimestamp(sessionStorage, attemptStorageKey, now);

      try {
        if (!web3FormsKey) throw new Error('The form is temporarily unavailable. Please try again later.');

        const web3FormsPayload = new FormData(consultationForm);
        web3FormsPayload.append('access_key', web3FormsKey);
        web3FormsPayload.append('from_name', 'MIRACON Website');
        web3FormsPayload.append('subject', `Consultation request from ${name}`);
        web3FormsPayload.append('page', window.location.pathname);
        if (!email) web3FormsPayload.set('email', 'not-provided@miracon.gr');
        if (email) web3FormsPayload.set('replyto', email);

        const response = await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body: web3FormsPayload,
        });
        const result = await response.json();

        if (!response.ok || !result.success) throw new Error(result.message || 'Unable to send your request.');

        consultationForm.reset();
        storeTimestamp(localStorage, successStorageKey, Date.now());
        setStatus('Thank you. Your request has been sent.', 'success');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Unable to send your request. Please try again later.', 'error');
      } finally {
        window.hcaptcha?.reset();
        updateSubmitState();
      }
    });
  });

  // Parse URL search parameters to activate filter automatically
  const urlParams = new URLSearchParams(window.location.search);
  const initialFilter = urlParams.get('filter');
  if (initialFilter) {
    const targetTab = Array.from(filterTabs).find(tab => tab.getAttribute('data-filter') === initialFilter);
    if (targetTab) {
      targetTab.click();
    }
  }
  // Project floor plans tab switching
  const planTabs = document.querySelectorAll('.project-plan-tab');
  const planCards = document.querySelectorAll('.project-plan-card[data-plan]');

  function setActivePlan(plan, revealShown = false) {
    const hasMatchingCards = Array.from(planCards).some(card => card.getAttribute('data-plan') === plan);

    if (!hasMatchingCards) {
      return;
    }

    planTabs.forEach(tab => {
      tab.classList.toggle('active', tab.getAttribute('data-plan-filter') === plan);
    });

    planCards.forEach(card => {
      const isVisible = card.getAttribute('data-plan') === plan;
      card.hidden = !isVisible;

      if (isVisible && revealShown) {
        card.style.transitionDelay = '';
        requestAnimationFrame(() => {
          card.classList.add('visible');
        });
      }
    });
  }

  if (planTabs.length > 0 && planCards.length > 0) {
    const activePlan = document.querySelector('.project-plan-tab.active')?.getAttribute('data-plan-filter')
      || planTabs[0].getAttribute('data-plan-filter');
    setActivePlan(activePlan);
  }

  planTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const selectedPlan = tab.getAttribute('data-plan-filter');
      setActivePlan(selectedPlan, true);
    });
  });

  /* ==========================================================================
     PROJECT MAPS
     Load Google Maps only shortly before the location section enters view.
     This keeps third-party requests out of the initial page load.
     ========================================================================== */
  const projectMapSections = document.querySelectorAll('.project-location-section[data-map-src]');

  projectMapSections.forEach(section => {
    const mapFrame = section.querySelector('.project-location-map');
    const mapSource = section.dataset.mapSrc;

    if (!mapFrame || !mapSource) {
      return;
    }

    const loadProjectMap = () => {
      if (mapFrame.dataset.loaded === 'true') {
        return;
      }

      mapFrame.dataset.loaded = 'true';
      mapFrame.removeAttribute('aria-hidden');
      section.classList.add('is-map-loading');

      mapFrame.addEventListener('load', () => {
        section.classList.remove('is-map-loading');
        section.classList.add('is-map-loaded');
      }, { once: true });

      mapFrame.src = mapSource;
    };

    if (!('IntersectionObserver' in window)) {
      loadProjectMap();
      return;
    }

    const mapObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) {
          return;
        }

        loadProjectMap();
        mapObserver.unobserve(section);
      });
    }, { rootMargin: '360px 0px' });

    mapObserver.observe(section);
  });
});
