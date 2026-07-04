document.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('js-enabled');

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
    },
    {
      element: document.querySelector('.project-gallery-image--far-right'),
      offset: 2
    }
  ];
  const galleryImages = gallerySlots.map(slot => slot.element).filter(Boolean);

  if (galleryImages.length === gallerySlots.length) {
    const gallerySlides = [];
    const gallerySlideKeys = new Set();

    galleryImages.forEach(image => {
      const src = image.getAttribute('src');
      const key = new URL(src, window.location.href).href;

      if (!gallerySlideKeys.has(key)) {
        gallerySlideKeys.add(key);
        gallerySlides.push({
          src,
          alt: image.getAttribute('alt') || ''
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
    consultationForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const name = document.getElementById('formName').value.trim();
      const phone = document.getElementById('formPhone').value.trim();
      const email = document.getElementById('formEmail').value.trim();
      const message = document.getElementById('formMessage').value.trim();

      if (!name || !phone || !email || !message) {
        alert('Please fill out all fields.');
        return;
      }

      // Simulated success message
      const submitBtn = consultationForm.querySelector('.btn-submit');
      const originalContent = submitBtn.innerHTML;

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Sending...</span>';

      setTimeout(() => {
        alert(`Thank you, ${name}! Your consultation request has been sent successfully.`);
        consultationForm.reset();
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalContent;
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
});
