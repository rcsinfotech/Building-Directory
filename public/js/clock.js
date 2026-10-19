function updateClock() {
    const now = new Date();
    
    // Format time
    const timeString = now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
    
    // Format date
    const dateString = now.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    // Update DOM elements
    const clockElement = document.getElementById('live-clock');
    const dateElement = document.getElementById('current-date');
    
    if (clockElement) {
        clockElement.textContent = timeString;
    }
    
    if (dateElement) {
        dateElement.textContent = dateString;
    }
}

// Update clock immediately and then every second
updateClock();
setInterval(updateClock, 1000);
