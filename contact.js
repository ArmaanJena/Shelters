// Contact Page JavaScript - Shelters Realty
document.addEventListener('DOMContentLoaded', function() {
    
    // Contact form handling
    const contactForm = document.getElementById('contact-form');
    const successModal = document.getElementById('success-modal');
    const modalClose = document.getElementById('modal-close');
    
    // Form submission
    contactForm.addEventListener('submit', function(e) {
        e.preventDefault();

        // Get form data
        const formData = new FormData(contactForm);
        const data = Object.fromEntries(formData.entries());

        // Validate form
        if (validateForm(data)) {
            // Construct the WhatsApp message
            const message = `
Hello Shelters Realty,

I'm sending a message from your website. Here are my details:
*Name:* ${data.firstName} ${data.lastName}
*Email:* ${data.email}
*Phone:* ${data.phone}

*Interested in Property Type:* ${data.propertyType || 'Not specified'}
*Budget Range:* ${data.budget || 'Not specified'}
*Preferred Location:* ${data.location || 'Not specified'}

*Message:*
${data.message}

*Newsletter Subscription:* ${data.newsletter ? 'Yes' : 'No'}
            `.trim();

            // The target WhatsApp number (e.g., Laila Jena's)
            const whatsappNumber = '919860826918';
            
            // Create the WhatsApp URL and open it in a new tab
            const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
            window.open(whatsappUrl, '_blank');

            // Show a notification and reset the form
            showNotification('Redirecting you to WhatsApp...', 'success');
            contactForm.reset();
        }
    });
    
    // Form validation
    function validateForm(data) {
        const errors = [];
        
        // Required fields validation
        if (!data.firstName.trim()) errors.push('First name is required');
        if (!data.lastName.trim()) errors.push('Last name is required');
        if (!data.email.trim()) errors.push('Email is required');
        if (!data.phone.trim()) errors.push('Phone number is required');
        if (!data.message.trim()) errors.push('Message is required');
        
        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (data.email && !emailRegex.test(data.email)) {
            errors.push('Please enter a valid email address');
        }
        
        // Phone validation
        const phoneRegex = /^[6-9]\d{9}$/;
        if (data.phone && !phoneRegex.test(data.phone.replace(/\D/g, ''))) {
            errors.push('Please enter a valid 10-digit phone number');
        }
        
        // Terms validation
        if (!data.terms) {
            errors.push('Please accept the terms and conditions');
        }
        
        if (errors.length > 0) {
            showErrors(errors);
            return false;
        }
        
        return true;
    }
    
    // Show validation errors
    function showErrors(errors) {
        // Remove existing error messages
        document.querySelectorAll('.error-message').forEach(msg => msg.remove());
        
        // Show errors
        errors.forEach(error => {
            showNotification(error, 'error');
        });
    }
    
    // Show loading state
    function showLoadingState() {
        const submitBtn = contactForm.querySelector('.submit-btn');
        submitBtn.innerHTML = `
            <span>Sending...</span>
            <div class="loading-spinner"></div>
        `;
        submitBtn.disabled = true;
    }
    
    // Hide loading state
    function hideLoadingState() {
        const submitBtn = contactForm.querySelector('.submit-btn');
        submitBtn.innerHTML = `
            <span>Send Message</span>
            <div class="button-glow"></div>
        `;
        submitBtn.disabled = false;
    }
    
    // Show success modal
    function showSuccessModal() {
        successModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
    
    // Hide success modal
    function hideSuccessModal() {
        successModal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
    
    // Modal close handlers
    modalClose.addEventListener('click', hideSuccessModal);
    successModal.addEventListener('click', function(e) {
        if (e.target === successModal) {
            hideSuccessModal();
        }
    });
    
    // Show notification
    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        
        // Add styles
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'error' ? '#ff6b6b' : 'var(--electric-blue)'};
            color: var(--obsidian);
            padding: 1rem 1.5rem;
            border-radius: var(--radius-md);
            font-weight: 600;
            z-index: 10000;
            transform: translateX(100%);
            transition: transform 0.3s ease;
            max-width: 400px;
            word-wrap: break-word;
        `;
        
        document.body.appendChild(notification);
        
        // Animate in
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 100);
        
        // Remove after 5 seconds
        setTimeout(() => {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 5000);
    }
    
    // Form input animations
    const formInputs = document.querySelectorAll('.form-input, .form-select, .form-textarea');
    formInputs.forEach(input => {
        input.addEventListener('focus', function() {
            this.parentElement.classList.add('focused');
        });
        
        input.addEventListener('blur', function() {
            if (!this.value) {
                this.parentElement.classList.remove('focused');
            }
        });
        
        // Check if input has value on load
        if (input.value) {
            input.parentElement.classList.add('focused');
        }
    });
    
    // Contact method hover effects
    const contactMethods = document.querySelectorAll('.contact-method');
    contactMethods.forEach(method => {
        method.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-8px)';
            this.style.boxShadow = '0 20px 40px rgba(15, 240, 252, 0.2)';
        });
        
        method.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
            this.style.boxShadow = '';
        });
    });
    
    // Contact links click tracking
    const contactLinks = document.querySelectorAll('.contact-link');
    contactLinks.forEach(link => {
        link.addEventListener('click', function() {
            const contactType = this.closest('.contact-method').querySelector('.method-title').textContent;
            const contactName = this.querySelector('.contact-name').textContent;
            
            // Track contact interaction (in real implementation, send to analytics)
            console.log(`Contact clicked: ${contactType} - ${contactName}`);
        });
    });
    
    // FAQ accordion functionality
    const faqItems = document.querySelectorAll('.faq-item');
    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        const answer = item.querySelector('.faq-answer');
        
        // Initially hide answers
        answer.style.display = 'none';
        
        question.addEventListener('click', function() {
            const isOpen = answer.style.display === 'block';
            
            // Close all other FAQ items
            faqItems.forEach(otherItem => {
                if (otherItem !== item) {
                    otherItem.querySelector('.faq-answer').style.display = 'none';
                    otherItem.classList.remove('active');
                }
            });
            
            // Toggle current item
            if (isOpen) {
                answer.style.display = 'none';
                item.classList.remove('active');
            } else {
                answer.style.display = 'block';
                item.classList.add('active');
            }
        });
    });
    
    // Form field formatting
    const phoneInput = document.getElementById('phone');
    phoneInput.addEventListener('input', function() {
        // Format phone number as user types
        let value = this.value.replace(/\D/g, '');
        if (value.length > 10) {
            value = value.substring(0, 10);
        }
        this.value = value;
    });
    
    // Auto-resize textarea
    const messageTextarea = document.getElementById('message');
    messageTextarea.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = this.scrollHeight + 'px';
    });
    
    // Intersection Observer for scroll animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, observerOptions);
    
    // Observe elements for scroll animations
    const animateElements = document.querySelectorAll('.contact-method, .faq-item, .contact-form-container, .contact-info-container');
    animateElements.forEach(el => {
        el.classList.add('fade-in');
        observer.observe(el);
    });
    
    // Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
    
    // Form submission analytics (placeholder)
    function trackFormSubmission(formData) {
        // In a real implementation, this would send data to analytics
        console.log('Form submission tracked:', {
            timestamp: new Date().toISOString(),
            formData: formData,
            userAgent: navigator.userAgent,
            referrer: document.referrer
        });
    }
    
    // Initialize form validation on page load
    const requiredFields = contactForm.querySelectorAll('[required]');
    requiredFields.forEach(field => {
        field.addEventListener('blur', function() {
            validateField(this);
        });
    });
    
    function validateField(field) {
        const value = field.value.trim();
        const fieldName = field.getAttribute('name');
        let isValid = true;
        let errorMessage = '';
        
        // Required field validation
        if (field.hasAttribute('required') && !value) {
            isValid = false;
            errorMessage = `${fieldName} is required`;
        }
        
        // Email validation
        if (fieldName === 'email' && value) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(value)) {
                isValid = false;
                errorMessage = 'Please enter a valid email address';
            }
        }
        
        // Phone validation
        if (fieldName === 'phone' && value) {
            const phoneRegex = /^[6-9]\d{9}$/;
            if (!phoneRegex.test(value.replace(/\D/g, ''))) {
                isValid = false;
                errorMessage = 'Please enter a valid 10-digit phone number';
            }
        }
        
        // Show/hide field error
        const existingError = field.parentElement.querySelector('.field-error');
        if (existingError) {
            existingError.remove();
        }
        
        if (!isValid) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'field-error';
            errorDiv.textContent = errorMessage;
            errorDiv.style.cssText = `
                color: #ff6b6b;
                font-size: 0.8rem;
                margin-top: 0.25rem;
            `;
            field.parentElement.appendChild(errorDiv);
            field.style.borderColor = '#ff6b6b';
        } else {
            field.style.borderColor = '';
        }
        
        return isValid;
    }
});
