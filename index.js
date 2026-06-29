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
  planTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      planTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });
});
