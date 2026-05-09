// Reader UX Enhancements
(function() {
  let navTimeout;
  let isInitialized = false;

  function initReaderEnhancements() {
    if (isInitialized) return;
    isInitialized = true;

    const readerContent = document.getElementById("readerContent");
    const sidebar = document.getElementById("readerSidebar");
    const overlay = document.getElementById("readerSidebarOverlay");

    // Close sidebar when clicking overlay
    if (overlay) {
      overlay.addEventListener("click", () => {
        sidebar?.classList.remove("is-open");
      });
    }

    // Auto-show navigation on mouse move
    document.addEventListener("mousemove", () => {
      document.body.classList.add("reader-nav-visible");
      clearTimeout(navTimeout);
      navTimeout = setTimeout(() => {
        if (!sidebar?.classList.contains("is-open")) {
          document.body.classList.remove("reader-nav-visible");
        }
      }, 2000);
    });

    // Show navigation when reaching top or bottom
    if (readerContent) {
      readerContent.addEventListener("scroll", () => {
        const scrollTop = readerContent.scrollTop;
        const scrollHeight = readerContent.scrollHeight;
        const clientHeight = readerContent.clientHeight;
        
        if (scrollTop < 50 || scrollTop + clientHeight > scrollHeight - 50) {
          document.body.classList.add("reader-nav-visible");
          clearTimeout(navTimeout);
          navTimeout = setTimeout(() => {
            if (!sidebar?.classList.contains("is-open")) {
              document.body.classList.remove("reader-nav-visible");
            }
          }, 2000);
        }
      });

      // Click navigation on images - improved logic
      readerContent.addEventListener("click", (event) => {
        // Ignore clicks on buttons, links, interactive elements, or navigation areas
        if (event.target.closest("button, a, [data-reader-link], .reader-nav-button, .reader-header, .reader-footer")) {
          return;
        }

        // Check if click is in navigation bar area (top 60px or bottom 80px)
        const viewportHeight = window.innerHeight;
        const clickY = event.clientY;
        
        if (clickY < 60 || clickY > viewportHeight - 80) {
          // Click is in navigation area, don\'t handle
          return;
        }

        const rect = readerContent.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const width = rect.width;
        const leftThird = width / 3;
        const rightThird = (width * 2) / 3;

        if (clickX < leftThird) {
          // Left side - previous page
          const prevButton = document.getElementById("readerPrevButton");
          if (prevButton && !prevButton.disabled) {
            prevButton.click();
          }
        } else if (clickX > rightThird) {
          // Right side - next page
          const nextButton = document.getElementById("readerNextButton");
          if (nextButton && !nextButton.disabled) {
            nextButton.click();
          }
        } else {
          // Middle - toggle navigation
          document.body.classList.toggle("reader-nav-visible");
          clearTimeout(navTimeout);
        }
      });
    }

    // Initial state - show navigation briefly then hide
    document.body.classList.add("reader-nav-visible");
    setTimeout(() => {
      document.body.classList.remove("reader-nav-visible");
    }, 3000);
  }

  // Initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initReaderEnhancements);
  } else {
    initReaderEnhancements();
  }
})();
