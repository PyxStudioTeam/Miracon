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
     PROJECT HERO VIDEO
     ========================================================================== */
  const projectHero = document.querySelector('.project-hero[data-project-hero]');
  const projectHeroVideo = projectHero?.querySelector('.project-hero-video');
  const projectHeroSoundButton = projectHero?.querySelector('.project-hero-sound-button');

  if (projectHero && projectHeroVideo) {
    const heroIdleDelay = 1800;
    const shouldIdleUi = projectHero.dataset.idleUi === 'true';
    let heroIdleTimeout;

    function setHeroIdle() {
      if (shouldIdleUi) {
        projectHero.classList.add('is-hero-idle');
      }
    }

    function wakeHero() {
      projectHero.classList.remove('is-hero-idle');
      window.clearTimeout(heroIdleTimeout);
      heroIdleTimeout = window.setTimeout(setHeroIdle, heroIdleDelay);
    }

    function syncHeroSoundButton() {
      if (!projectHeroSoundButton) {
        return;
      }

      const isSoundOn = !projectHeroVideo.muted && projectHeroVideo.volume > 0;
      const soundText = projectHeroSoundButton.querySelector('.project-hero-sound-text');

      projectHeroSoundButton.classList.toggle('is-sound-on', isSoundOn);
      projectHeroSoundButton.setAttribute('aria-pressed', String(isSoundOn));
      projectHeroSoundButton.setAttribute('aria-label', isSoundOn ? 'Mute video sound' : 'Enable video sound');

      if (soundText) {
        soundText.textContent = isSoundOn ? 'Mute' : 'Sound';
      }
    }

    function toggleHeroSound(event) {
      if (event) {
        event.stopPropagation();
      }

      if (!projectHeroVideo.muted && projectHeroVideo.volume > 0) {
        projectHeroVideo.muted = true;
        syncHeroSoundButton();
        return;
      }

      projectHeroVideo.muted = false;
      projectHeroVideo.volume = 1;
      projectHeroVideo.play().catch(() => {
        projectHeroVideo.muted = true;
      }).finally(syncHeroSoundButton);

      syncHeroSoundButton();
    }

    function enableHeroVideoPlayback() {
      projectHeroVideo.muted = true;
      const playPromise = projectHeroVideo.play();

      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
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
    }

    if (projectHeroSoundButton) {
      projectHeroSoundButton.addEventListener('click', toggleHeroSound);
      projectHeroVideo.addEventListener('volumechange', syncHeroSoundButton);
    }

    if (shouldIdleUi) {
      wakeHero();
    }
    syncHeroSoundButton();
    enableHeroVideoPlayback();
  }

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
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const galleryStrip = document.querySelector('.project-gallery-strip');
      const galleryDragHint = galleryStrip?.querySelector('.project-gallery-drag-hint');
      let galleryAutoplayId;
      let galleryDragStartX = 0;
      let galleryDragDeltaX = 0;
      let isGalleryDragging = false;

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
            slot.element.src = slide.src;
            slot.element.alt = slide.alt;
            slot.element.style.objectPosition = `${slide.focalX}% ${slide.focalY}%`;
          });
        };

        if (!animate || prefersReducedMotion) {
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

      function startGalleryAutoplay() {
        window.clearInterval(galleryAutoplayId);
        galleryAutoplayId = window.setInterval(() => moveGallery(1), 5000);
      }

      function resetGalleryAutoplay() {
        if (!prefersReducedMotion) startGalleryAutoplay();
      }

      function isGalleryInteractiveTarget(target) {
        return target instanceof Element && Boolean(target.closest('a, button'));
      }

      function updateGalleryCursor(event) {
        if (!galleryDragHint) return;
        const rect = galleryStrip.getBoundingClientRect();
        galleryStrip.style.setProperty('--gallery-cursor-x', `${event.clientX - rect.left}px`);
        galleryStrip.style.setProperty('--gallery-cursor-y', `${event.clientY - rect.top}px`);
      }

      if (!prefersReducedMotion) startGalleryAutoplay();

      galleryStrip.addEventListener('pointerenter', event => {
        if (isGalleryInteractiveTarget(event.target)) return;
        updateGalleryCursor(event);
        galleryStrip.classList.add('is-gallery-hovered');
      });
      galleryStrip.addEventListener('pointerleave', () => {
        if (!isGalleryDragging) galleryStrip.classList.remove('is-gallery-hovered', 'is-over-control');
      });
      galleryStrip.addEventListener('pointerdown', event => {
        if (isGalleryInteractiveTarget(event.target)) return;
        updateGalleryCursor(event);
        isGalleryDragging = true;
        galleryDragStartX = event.clientX;
        galleryDragDeltaX = 0;
        galleryStrip.classList.add('is-gallery-hovered', 'is-dragging');
        galleryStrip.setPointerCapture(event.pointerId);
        window.clearInterval(galleryAutoplayId);
      });
      galleryStrip.addEventListener('pointermove', event => {
        galleryStrip.classList.toggle('is-over-control', isGalleryInteractiveTarget(event.target));
        if (isGalleryInteractiveTarget(event.target)) return;
        updateGalleryCursor(event);
        if (!isGalleryDragging) return;
        galleryDragDeltaX = Math.max(-160, Math.min(160, event.clientX - galleryDragStartX));
        galleryStrip.style.setProperty('--gallery-drag-x', `${galleryDragDeltaX}px`);
      });

      function finishGalleryDrag(event) {
        if (!isGalleryDragging) return;
        isGalleryDragging = false;
        galleryStrip.classList.remove('is-dragging');
        if (galleryStrip.hasPointerCapture(event.pointerId)) galleryStrip.releasePointerCapture(event.pointerId);
        galleryStrip.style.setProperty('--gallery-drag-x', '0px');
        if (Math.abs(galleryDragDeltaX) > 68) moveGallery(galleryDragDeltaX < 0 ? 1 : -1);
        galleryDragDeltaX = 0;
        resetGalleryAutoplay();
      }

      galleryStrip.addEventListener('pointerup', finishGalleryDrag);
      galleryStrip.addEventListener('pointercancel', finishGalleryDrag);
      galleryStrip.addEventListener('focusin', event => {
        galleryStrip.classList.toggle('is-over-control', isGalleryInteractiveTarget(event.target));
      });
      galleryStrip.addEventListener('focusout', () => galleryStrip.classList.remove('is-over-control'));
      galleryStrip.addEventListener('dblclick', event => {
        if (isGalleryInteractiveTarget(event.target)) return;
        moveGallery(1);
        resetGalleryAutoplay();
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
    const formStartedAt = Date.now();

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
      const emailInput = consultationForm.querySelector('[name="email"]');

      if (!name || (!phone && !email)) {
        setStatus('Please enter your name and at least one contact detail.', 'error');
        return;
      }

      if (email && emailInput && !emailInput.checkValidity()) {
        setStatus('Please enter a valid email address.', 'error');
        return;
      }

      submitBtn.disabled = true;
      setStatus('Sending your request...', 'pending');

      try {
        const response = await fetch('/api/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            phone,
            email,
            message: String(formData.get('message') || ''),
            website: String(formData.get('website') || ''),
            consent: formData.get('consent') === 'on',
            page: window.location.pathname,
            formStartedAt,
          }),
        });
        const result = await response.json();

        if (!response.ok) throw new Error(result.message || 'Unable to send your request.');

        consultationForm.reset();
        setStatus('Thank you. Your request has been sent.', 'success');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Unable to send your request. Please try again later.', 'error');
      } finally {
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
