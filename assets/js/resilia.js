/**
 * RESILIA — Master Script
 * Brand: RESILIA ("The journey of nurturing resilience.")
 */

document.addEventListener('DOMContentLoaded', () => {
  initHeader();
  initMobileNav();
  initScrollAnimations();
  initBookingFlow();
  initContactForm();
});

/* 1. Header Scroll */
function initHeader() {
  const header = document.querySelector('.site-header');
  if (!header) return;

  const onScroll = () => {
    if (window.scrollY > 20) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* 2. Mobile Nav */
function initMobileNav() {
  const toggleBtn = document.querySelector('.mobile-nav-toggle');
  const mainNav = document.querySelector('.main-nav');
  if (!toggleBtn || !mainNav) return;

  const toggleMenu = (open) => {
    const shouldOpen = open !== undefined ? open : !mainNav.classList.contains('is-open');
    if (shouldOpen) {
      mainNav.classList.add('is-open');
      toggleBtn.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
    } else {
      mainNav.classList.remove('is-open');
      toggleBtn.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }
  };

  toggleBtn.addEventListener('click', () => toggleMenu());

  mainNav.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      toggleMenu(false);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mainNav.classList.contains('is-open')) {
      toggleMenu(false);
    }
  });
}

/* 3. Scroll Reveal */
function initScrollAnimations() {
  const elements = document.querySelectorAll('.fade-in-up');
  if (!elements.length) return;

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          obs.unobserve(entry.target);
        }
      });
    }, {
      root: null,
      threshold: 0.08,
      rootMargin: '0px 0px -40px 0px'
    });

    elements.forEach(el => observer.observe(el));
  } else {
    elements.forEach(el => el.classList.add('is-visible'));
  }
}

/* Validation Helpers */
function isValidEmail(email) {
  const re = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;
  return re.test(String(email).trim());
}

function isValidPhone(phone) {
  const digits = String(phone).replace(/\D/g, '');
  return /^[6-9]\d{9}$/.test(digits);
}

/* 4. Multi-Step Booking Flow (Two Chairs & Mindsight Inspired) */
function initBookingFlow() {
  const bookingContainer = document.querySelector('.booking-flow-card');
  if (!bookingContainer) return;

  const state = {
    step: 1,
    service: '',
    mode: '',
    date: '',
    time: '',
    name: '',
    phone: '',
    email: '',
    message: ''
  };

  let isSubmitting = false;

  const stepPill = document.getElementById('booking-step-num');
  const stepPanels = document.querySelectorAll('.booking-step-panel');
  const nextBtns = document.querySelectorAll('[data-booking-next]');
  const prevBtns = document.querySelectorAll('[data-booking-prev]');
  const bookingPhoneInput = document.getElementById('booking-phone');
  if (bookingPhoneInput) {
    bookingPhoneInput.addEventListener('input', () => {
      bookingPhoneInput.value = bookingPhoneInput.value.replace(/\D/g, '').slice(0, 10);
    });
  }

  function showStep(stepNum) {
    state.step = stepNum;
    if (stepPill) {
      if (stepNum <= 5) {
        stepPill.textContent = `STEP 0${stepNum} / 05`;
      } else {
        stepPill.textContent = `COMPLETED`;
      }
    }

    stepPanels.forEach(panel => {
      const panelStep = parseInt(panel.getAttribute('data-step'), 10);
      if (panelStep === stepNum) {
        panel.style.display = 'block';
      } else {
        panel.style.display = 'none';
      }
    });

    if (stepNum === 5) {
      updateReviewSummary();
    }
  }

  // Step 1: Support service selection
  const supportOptions = document.querySelectorAll('#step-support-options .step-option-btn');
  supportOptions.forEach(btn => {
    btn.addEventListener('click', () => {
      supportOptions.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.service = btn.getAttribute('data-value');
    });
  });

  // Step 2: Preference mode selection
  const prefOptions = document.querySelectorAll('#step-pref-options .step-option-btn');
  prefOptions.forEach(btn => {
    btn.addEventListener('click', () => {
      prefOptions.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.mode = btn.getAttribute('data-value');
    });
  });

  // Clear field errors
  function clearErrors() {
    const banner4 = document.getElementById('step4-error-banner');
    if (banner4) banner4.style.display = 'none';
    const subBanner = document.getElementById('submission-error-banner');
    if (subBanner) subBanner.style.display = 'none';

    ['name', 'phone', 'email'].forEach(field => {
      const el = document.getElementById(`err-${field}`);
      if (el) {
        el.textContent = '';
        el.style.display = 'none';
      }
      const inp = document.getElementById(`booking-${field}`);
      if (inp) inp.style.borderColor = '';
    });
  }

  function showFieldError(field, msg) {
    const el = document.getElementById(`err-${field}`);
    if (el) {
      el.textContent = msg;
      el.style.display = 'block';
    }
    const inp = document.getElementById(`booking-${field}`);
    if (inp) inp.style.borderColor = '#CF1322';
  }

  // Navigation handlers
  nextBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      clearErrors();

      if (state.step === 1) {
        if (!state.service) {
          alert('Please choose the kind of support you are looking for.');
          return;
        }
      }

      if (state.step === 2) {
        if (!state.mode) {
          alert('Please select In-Person or Online preference.');
          return;
        }
      }

      if (state.step === 3) {
        const dateInput = document.getElementById('booking-date');
        const timeInput = document.getElementById('booking-time');
        state.date = dateInput ? dateInput.value : '';
        state.time = timeInput ? timeInput.value : '';
      }

      if (state.step === 4) {
        const nameInput = document.getElementById('booking-name');
        const phoneInput = document.getElementById('booking-phone');
        const emailInput = document.getElementById('booking-email');
        const msgInput = document.getElementById('booking-message');

        const nameVal = nameInput ? nameInput.value.trim() : '';
        const phoneVal = phoneInput ? phoneInput.value.trim() : '';
        const emailVal = emailInput ? emailInput.value.trim() : '';
        const msgVal = msgInput ? msgInput.value.trim() : '';

        let hasError = false;

        if (!nameVal) {
          showFieldError('name', 'Full Name is required.');
          hasError = true;
        }

        if (!phoneVal) {
          showFieldError('phone', 'Phone Number is required.');
          hasError = true;
        } else if (!isValidPhone(phoneVal)) {
          showFieldError('phone', 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.');
          hasError = true;
        }

        if (!emailVal) {
          showFieldError('email', 'Email Address is required.');
          hasError = true;
        } else if (!isValidEmail(emailVal)) {
          showFieldError('email', 'Please enter a valid email address (e.g. name@domain.com).');
          hasError = true;
        }

        if (hasError) {
          const banner4 = document.getElementById('step4-error-banner');
          if (banner4) {
            banner4.textContent = 'Please check the required fields highlighted below.';
            banner4.style.display = 'block';
          }
          return;
        }

        state.name = nameVal;
        state.phone = phoneVal;
        state.email = emailVal;
        state.message = msgVal;
      }

      showStep(state.step + 1);
    });
  });

  prevBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      clearErrors();
      if (state.step > 1) {
        showStep(state.step - 1);
      }
    });
  });

  // Final Step 5 Submission to /api/appointment
  const submitRequestBtn = document.getElementById('send-appointment-request-btn');
  if (submitRequestBtn) {
    submitRequestBtn.addEventListener('click', async () => {
      if (isSubmitting) return; // Prevent duplicate submissions

      const subBanner = document.getElementById('submission-error-banner');
      if (subBanner) subBanner.style.display = 'none';

      isSubmitting = true;
      submitRequestBtn.disabled = true;
      submitRequestBtn.textContent = 'Sending Request...';
      submitRequestBtn.style.opacity = '0.7';

      try {
        const payload = {
          name: state.name,
          phone: state.phone,
          email: state.email,
          service: state.service,
          mode: state.mode || 'Not specified',
          date: state.date || 'Flexible / To be coordinated',
          time: state.time || 'Flexible / To be coordinated',
          message: state.message || ''
        };

        const response = await fetch('/api/appointment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (response.ok && result.success) {
          const acknowledgmentStatus = document.getElementById('booking-acknowledgment-status');
          if (acknowledgmentStatus) {
            acknowledgmentStatus.textContent = result.acknowledgmentSent
              ? 'Our mail provider accepted a receipt email for delivery to the address you provided. Your appointment is not confirmed until our team contacts you.'
              : 'Your request is recorded, but we could not send the receipt email. Please contact resilia.the.resilience@gmail.com so we can confirm we have your details.';
          }
          showStep(6);
        } else {
          throw new Error(result.error || 'Server rejected the request.');
        }
      } catch (err) {
        console.error('Appointment submission error:', err);
        if (subBanner) {
          subBanner.innerHTML = `<strong>Submission Error:</strong> Unable to dispatch your request right now (${err.message || 'Network error'}). You can retry or contact us directly at <a href="mailto:resilia.the.resilience@gmail.com" style="color: inherit; text-decoration: underline;">resilia.the.resilience@gmail.com</a>.`;
          subBanner.style.display = 'block';
        } else {
          alert('Unable to send request. Please check your connection or email resilia.the.resilience@gmail.com directly.');
        }
      } finally {
        isSubmitting = false;
        submitRequestBtn.disabled = false;
        submitRequestBtn.textContent = 'Send Appointment Request';
        submitRequestBtn.style.opacity = '1';
      }
    });
  }

  function updateReviewSummary() {
    const revSupport = document.getElementById('rev-support');
    const revPref = document.getElementById('rev-pref');
    const revDate = document.getElementById('rev-date');
    const revTime = document.getElementById('rev-time');
    const revName = document.getElementById('rev-name');
    const revPhone = document.getElementById('rev-phone');
    const revEmail = document.getElementById('rev-email');
    const revMsg = document.getElementById('rev-msg');

    if (revSupport) revSupport.textContent = state.service || '—';
    if (revPref) revPref.textContent = state.mode || '—';
    if (revDate) revDate.textContent = state.date || 'Flexible';
    if (revTime) revTime.textContent = state.time || 'Flexible';
    if (revName) revName.textContent = state.name || '—';
    if (revPhone) revPhone.textContent = state.phone || '—';
    if (revEmail) revEmail.textContent = state.email || '—';
    if (revMsg) revMsg.textContent = state.message || '—';
  }

  // Initialize Step 1
  showStep(1);
}

/* 5. Contact Form Handler */
function initContactForm() {
  const form = document.querySelector('.contact-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    if (!btn || btn.disabled) return;

    const nameInput = form.querySelector('[name="name"], #contact-name, input[type="text"]');
    const emailInput = form.querySelector('[name="email"], #contact-email, input[type="email"]');
    const subjectInput = form.querySelector('[name="subject"], #contact-subject, select');
    const msgInput = form.querySelector('[name="message"], #contact-message, textarea');

    const name = nameInput ? nameInput.value.trim() : '';
    const email = emailInput ? emailInput.value.trim() : '';
    const subject = subjectInput ? subjectInput.value : '';
    const message = msgInput ? msgInput.value.trim() : '';

    if (!name || !email || !isValidEmail(email) || !message) {
      alert('Please fill in your name, a valid email address, and your message.');
      return;
    }

    btn.textContent = 'Sending...';
    btn.disabled = true;

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, subject, message })
      });

      const result = await response.json();

      if (response.ok && result.success) {
        form.innerHTML = `
          <div style="padding: 2.5rem 1.5rem; text-align: center; background: rgba(255, 255, 255, 0.12); border-radius: var(--radius-lg); border: 1px solid rgba(236, 227, 222, 0.2);">
            <div style="width: 48px; height: 48px; border-radius: 50%; background: var(--color-ivory); color: var(--color-primary-deep); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 1.25rem;">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <h3 style="font-family: var(--font-serif); font-size: 1.85rem; color: #FFFFFF; margin-bottom: 0.65rem;">Your request has been received.</h3>
            <p style="font-size: 0.95rem; color: var(--color-text-on-dark-muted); max-width: 420px; margin: 0 auto; line-height: 1.7;">
              Thank you for reaching out to Resilia. We will be in touch regarding the next step.
            </p>
          </div>
        `;
      } else {
        throw new Error(result.error || 'Failed to submit enquiry.');
      }
    } catch (err) {
      alert(`Unable to send enquiry: ${err.message}. You can reach us directly at resilia.the.resilience@gmail.com.`);
      btn.textContent = 'Send Enquiry';
      btn.disabled = false;
    }
  });
}
