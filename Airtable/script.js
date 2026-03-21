// script.js

// Function to fetch data from Google Sheets and display properties
async function loadProperties() {
    const googleSheetUrl = 'YOUR_GOOGLE_SHEET_CSV_URL'; // Replace with your published Google Sheet URL

    try {
        const response = await fetch(googleSheetUrl);
        const csvData = await response.text();

        const properties = csvToArray(csvData);

        const propertiesContainer = document.getElementById('properties-container'); // Assuming you have a container with this ID

        properties.forEach(property => {
            if (!property || !property.Price) return; // Skip empty or malformed rows

            const propertyElement = document.createElement('div');
            propertyElement.className = 'property'; // Reverting to the original "boxed" style
            // Set data attributes for filtering if they exist in your sheet
            if(property.Category) propertyElement.dataset.category = property.Category.toLowerCase().replace(' ', '-');
            if(property.Location) propertyElement.dataset.location = property.Location.toLowerCase().replace(' ', '-');
            if(property.Price) propertyElement.dataset.price = property.Price.replace(/[^0-9]/g, '');

            const imageUrl = property.ImageURL || 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=80';

            propertyElement.innerHTML = `
                <img src="${imageUrl}" alt="${property.Title || property.Address}">
                <h3>${property.Title || property.Address}</h3>
                <p class="location">📍 ${property.Location || ''}</p>
                <p class="price">₹${property.Price}</p>
                <p>${property.Description || ''}</p>
                <div class="actions">
                    <a href="property-detail.html?id=${property.id}" class="btn btn-primary">View Details</a>
                    <button class="btn btn-secondary">Save</button>
                </div>
            `;
            propertiesContainer.appendChild(propertyElement);
        });
    } catch (error) {
        console.error('Error fetching or parsing data:', error);
        document.getElementById('properties-container').innerText = 'Failed to load properties.';
    }
}

// Function to convert CSV data to an array of objects
function csvToArray(csv) {
    const lines = csv.split('\n');
    const headers = lines[0].split(',');
    return lines.slice(1).map(line => {
        // Handle cases where values might contain commas
        const values = line.split(',');
        if (values.length < headers.length) return null; // Skip malformed rows

        return headers.reduce((obj, header, index) => {
            obj[header] = values[index];
            return obj;
        }, {});
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Only load properties if we are on a page with the container
    if (document.getElementById('properties-container')) {
        loadProperties();
    }

    // Hero section search tabs
    const searchTabs = document.querySelectorAll('.search-tab-btn');
    const searchContents = document.querySelectorAll('.search-panel .search-form');

    searchTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Deactivate all tabs and content
            searchTabs.forEach(t => t.classList.remove('active'));
            searchContents.forEach(c => {
                c.classList.remove('active');
                c.style.display = 'none';
            });

            // Activate the clicked tab
            tab.classList.add('active');

            // Activate the corresponding content
            const tabId = tab.dataset.tab;
            const activeContent = document.getElementById(`${tabId}-form`);
            if (activeContent) {
                activeContent.classList.add('active');
                activeContent.style.display = 'flex';
            }
        });
    });

    // Handle "Find a Property" form submission
    const findForm = document.getElementById('find-form');
    if (findForm) {
        findForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const formData = new FormData(findForm);
            const params = new URLSearchParams();

            for (const [key, value] of formData.entries()) {
                if (value) { // Only add parameters that have a value
                    params.append(key, value);
                }
            }

            window.location.href = `listings.html?${params.toString()}`;
        });
    }

    // Mobile navigation toggle
    const navToggle = document.getElementById('nav-toggle');
    const navMenu = document.getElementById('nav-menu');

    if (navToggle && navMenu) {
        navToggle.addEventListener('click', () => {
            navToggle.classList.toggle('active');
            navMenu.classList.toggle('active');
        });
    }

    // Dark Mode Toggle
    const themeToggle = document.getElementById('theme-toggle');
    const htmlEl = document.documentElement;

    // Function to set the theme
    function setTheme(theme) {
        if (theme === 'dark') {
            htmlEl.classList.add('dark-mode');
            localStorage.setItem('theme', 'dark');
        } else {
            htmlEl.classList.remove('dark-mode');
            localStorage.setItem('theme', 'light');
        }
    }

    // Event listener for the toggle button
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            if (htmlEl.classList.contains('dark-mode')) {
                setTheme('light');
            } else {
                setTheme('dark');
            }
        });
    }

    // Check for saved theme in localStorage or user's OS preference on page load
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (savedTheme) {
        setTheme(savedTheme);
    } else if (prefersDark) {
        setTheme('dark');
    }
});