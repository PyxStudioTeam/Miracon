document.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('js-enabled');

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
  const projectHero = document.querySelector('.kriopigi-page .project-hero');
  const projectHeroVideo = projectHero?.querySelector('.project-hero-video');
  const projectHeroSoundButton = projectHero?.querySelector('.project-hero-sound-button');

  if (projectHero && projectHeroVideo) {
    const heroIdleDelay = 1800;
    let heroIdleTimeout;

    function setHeroIdle() {
      projectHero.classList.add('is-hero-idle');
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

    projectHero.addEventListener('pointerenter', wakeHero);
    projectHero.addEventListener('pointermove', wakeHero);
    projectHero.addEventListener('focusin', wakeHero);
    projectHero.addEventListener('touchstart', wakeHero, { passive: true });
    projectHero.addEventListener('pointerleave', () => {
      window.clearTimeout(heroIdleTimeout);
      heroIdleTimeout = window.setTimeout(setHeroIdle, heroIdleDelay);
    });

    if (projectHeroSoundButton) {
      projectHeroSoundButton.addEventListener('click', toggleHeroSound);
      projectHeroVideo.addEventListener('volumechange', syncHeroSoundButton);
    }

    wakeHero();
    syncHeroSoundButton();
    enableHeroVideoPlayback();
  }

  /* ==========================================================================
     MOBILE NAVIGATION MENU
     ========================================================================== */
  /* const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const mobileNav = document.getElementById('mobileNav');
  const mobileNavLinks = document.querySelectorAll('.mobile-nav-link');

  if (mobileMenuBtn && mobileNav) {
    mobileMenuBtn.addEventListener('click', () => {
      mobileNav.classList.toggle('active');
      
      // Toggle button icon if needed, or simply style with CSS
      const img = mobileMenuBtn.querySelector('img');
      if (mobileNav.classList.contains('active')) {
        img.style.transform = 'rotate(90deg)';
      } else {
        img.style.transform = 'rotate(0)';
      }
    });

    // Close menu when a link is clicked
    mobileNavLinks.forEach(link => {
      link.addEventListener('click', () => {
        mobileNav.classList.remove('active');
        const img = mobileMenuBtn.querySelector('img');
        if (img) img.style.transform = 'rotate(0)';
      });
    });
  } */

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

      // Set active tab
      filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const filterValue = tab.getAttribute('data-filter');

      // Filter cards
      projectCards.forEach(card => {
        const categories = card.getAttribute('data-category').split(' ');

        if (filterValue === 'all' || categories.includes(filterValue)) {
          card.style.display = 'grid';
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
  const gallerySlots = [
    {
      element: document.querySelector('.project-gallery-image--far-left'),
      offset: -2
    },
    {
      element: document.querySelector('.project-gallery-image--left'),
      offset: -1
    },
    {
      element: document.querySelector('.project-gallery-image--main'),
      offset: 0
    },
    {
      element: document.querySelector('.project-gallery-image--right-small'),
      offset: 1
    }
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
          alt: image.getAttribute('data-alt') || image.getAttribute('alt') || ''
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

      gallerySlides.forEach(slide => {
        const preloadedImage = new Image();
        preloadedImage.src = slide.src;
      });

      function getGallerySlide(offset) {
        const slideIndex = (currentGalleryIndex + offset + gallerySlides.length) % gallerySlides.length;
        return gallerySlides[slideIndex];
      }

      function renderGallerySlide(animate = true) {
        const updateImages = () => {
          gallerySlots.forEach(slot => {
            const slide = getGallerySlide(slot.offset);
            slot.element.src = slide.src;
            slot.element.alt = slide.alt;
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
        galleryAutoplayId = window.setInterval(() => {
          moveGallery(1);
        }, 5000);
      }

      function resetGalleryAutoplay() {
        if (!prefersReducedMotion) {
          startGalleryAutoplay();
        }
      }

      function isGalleryInteractiveTarget(target) {
        return target instanceof Element && Boolean(target.closest('a, button'));
      }

      function updateGalleryCursor(event) {
        if (!galleryDragHint) {
          return;
        }

        const rect = galleryStrip.getBoundingClientRect();
        galleryStrip.style.setProperty('--gallery-cursor-x', `${event.clientX - rect.left}px`);
        galleryStrip.style.setProperty('--gallery-cursor-y', `${event.clientY - rect.top}px`);
      }

      if (!prefersReducedMotion) {
        startGalleryAutoplay();
      }

      galleryStrip.addEventListener('pointerenter', event => {
        if (isGalleryInteractiveTarget(event.target)) {
          return;
        }

        updateGalleryCursor(event);
        galleryStrip.classList.add('is-gallery-hovered');
      });

      galleryStrip.addEventListener('pointerleave', () => {
        if (!isGalleryDragging) {
          galleryStrip.classList.remove('is-gallery-hovered');
        }
      });

      galleryStrip.addEventListener('pointerdown', event => {
        if (isGalleryInteractiveTarget(event.target)) {
          return;
        }

        updateGalleryCursor(event);
        isGalleryDragging = true;
        galleryDragStartX = event.clientX;
        galleryDragDeltaX = 0;
        galleryStrip.classList.add('is-gallery-hovered');
        galleryStrip.classList.add('is-dragging');
        galleryStrip.setPointerCapture(event.pointerId);
        window.clearInterval(galleryAutoplayId);
      });

      galleryStrip.addEventListener('pointermove', event => {
        updateGalleryCursor(event);

        if (isGalleryInteractiveTarget(event.target) && !isGalleryDragging) {
          galleryStrip.classList.remove('is-gallery-hovered');
          return;
        }

        galleryStrip.classList.add('is-gallery-hovered');

        if (!isGalleryDragging) {
          return;
        }

        galleryDragDeltaX = Math.max(-160, Math.min(160, event.clientX - galleryDragStartX));
        galleryStrip.style.setProperty('--gallery-drag-x', `${galleryDragDeltaX}px`);
      });

      function finishGalleryDrag(event) {
        if (!isGalleryDragging) {
          return;
        }

        isGalleryDragging = false;
        galleryStrip.classList.remove('is-dragging');
        if (galleryStrip.hasPointerCapture(event.pointerId)) {
          galleryStrip.releasePointerCapture(event.pointerId);
        }
        galleryStrip.style.setProperty('--gallery-drag-x', '0px');

        if (Math.abs(galleryDragDeltaX) > 68) {
          moveGallery(galleryDragDeltaX < 0 ? 1 : -1);
        }

        if (event.type === 'pointercancel') {
          galleryStrip.classList.remove('is-gallery-hovered');
        }

        galleryDragDeltaX = 0;
        resetGalleryAutoplay();
      }

      galleryStrip.addEventListener('pointerup', finishGalleryDrag);
      galleryStrip.addEventListener('pointercancel', finishGalleryDrag);

      galleryStrip.addEventListener('dblclick', event => {
        if (isGalleryInteractiveTarget(event.target)) {
          return;
        }

        moveGallery(1);
        resetGalleryAutoplay();
      });
    }
  }

  /* ==========================================================================
     CONSULTATION FORM SUBMISSION
     ========================================================================== */
  const consultationForm = document.getElementById('consultationForm');

  if (consultationForm) {
    const consent = document.getElementById('formConsent');
    const submitBtn = consultationForm.querySelector('.btn-submit');

    const updateSubmitState = () => {
      if (submitBtn && consent) {
        submitBtn.disabled = !consent.checked;
      }
    };

    updateSubmitState();

    if (consent) {
      consent.addEventListener('change', updateSubmitState);
    }

    consultationForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const name = document.getElementById('formName').value.trim();
      const userName = name ? `, ${name}` : '';

      // Simulated success message
      const originalContent = submitBtn.innerHTML;

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Sending...</span>';

      setTimeout(() => {
        alert(`Thank you${userName}! Your consultation request has been sent successfully.`);
        consultationForm.reset();
        submitBtn.innerHTML = originalContent;
        updateSubmitState();
      }, 1500);
    });
  }

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
  const planLabels = {
    duplex: 'Typical duplex apartment 123m\u00b2',
    studio: 'Typical studio 44m\u00b2',
    apartment: 'Typical apartment 44m\u00b2'
  };

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
    planTabs.forEach(tab => {
      const plan = tab.getAttribute('data-plan-filter');
      const label = planLabels[plan];
      const labelElement = tab.querySelector('span');

      if (label && labelElement) {
        labelElement.textContent = label;
        labelElement.setAttribute('data-label', label);
      }
    });

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
