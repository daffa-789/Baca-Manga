const READER_ENDPOINT = "/api/reader/manga";
const BOOKS_ENDPOINT = "/api/books";
const MIN_SESSION_SECONDS = 5;

const state = {
  currentUser: null,
  reader: null,
  session: null,
  drawerOpen: false,
  interactionsAttached: false,
  pageElements: [],
  currentPageIndex: 0,
  navVisible: false,
};

function getCurrentUserSession() {
  return window.OtakuSession.getCurrentUserSession();
}

function clearCurrentUserSession() {
  window.OtakuSession.clearCurrentUserSession();
}

function redirectToLogin() {
  clearCurrentUserSession();
  window.location.replace("/login.html");
}

function escapeHtml(value) {
  return window.OtakuCore.escapeHtml(value);
}

function renderImageWithFallback(
  src,
  alt,
  fallbackLabel,
  fallbackClass = "cover-fallback",
) {
  return window.OtakuCore.renderImageWithFallback(src, alt, fallbackLabel, {
    fallbackClass,
  });
}

function formatDate(value) {
  return window.OtakuCore.formatDate(value, {
    emptyLabel: "Belum diatur",
  });
}

async function parseJsonResponse(response) {
  return window.OtakuCore.parseJsonResponse(response);
}

function getAuthHeaders(baseHeaders = {}) {
  return window.OtakuCore.buildAuthHeaders(state.currentUser, baseHeaders);
}

function parseReaderRoute() {
  const match = window.location.pathname.match(
    /^\/read\/manga\/([^/]+)\/([^/]+)\/([^/]+)\/?$/i,
  );

  if (!match) {
    return null;
  }

  return {
    slug: decodeURIComponent(match[1]),
    chapter: match[2],
    page: match[3],
  };
}

function hydrateReaderIdentity() {
  const dashboardLink = document.getElementById("readerDashboardLink");

  if (dashboardLink) {
    const label = "Kembali ke Dashboard";
    dashboardLink.setAttribute("aria-label", label);
    dashboardLink.setAttribute("title", label);
  }
}

function setNavButtonState(buttonId, href) {
  const button = document.getElementById(buttonId);

  if (!button) {
    return;
  }

  button.dataset.href = href || "";
  button.disabled = !href;
}

function updatePageIndicators(text) {
  const desktopIndicator = document.getElementById("readerPageIndicator");
  const mobileIndicator = document.getElementById("readerPageIndicatorMobile");

  if (desktopIndicator) {
    desktopIndicator.textContent = text;
  }

  if (mobileIndicator) {
    mobileIndicator.textContent = text;
  }
}

function updateReaderHeader(data) {
  const bookTitle = document.getElementById("readerBookTitle");

  if (bookTitle) {
    bookTitle.textContent = escapeHtml(data.book.title);
  }
}

function updateReaderHeaderPage(currentPage, totalPages) {
  return;
}

function updateReaderRoutePage(pageNumber) {
  const safePageNumber = Number.parseInt(String(pageNumber || ""), 10);

  if (!Number.isInteger(safePageNumber) || safePageNumber <= 0) {
    return;
  }

  const currentUrl = new URL(window.location.href);
  const segments = currentUrl.pathname.split("/").filter(Boolean);

  if (segments.length < 5) {
    return;
  }

  if (segments[0] !== "read" || segments[1] !== "manga") {
    return;
  }

  const nextPathname = `/${[segments[0], segments[1], segments[2], segments[3], String(safePageNumber)].join("/")}`;

  if (nextPathname === currentUrl.pathname) {
    return;
  }

  history.replaceState(
    null,
    "",
    `${nextPathname}${currentUrl.search}${currentUrl.hash}`,
  );
}

function setReaderNavigationVisible(visible) {
  const shouldShow = Boolean(visible);

  if (state.navVisible === shouldShow) {
    return;
  }

  state.navVisible = shouldShow;
  document.body.classList.toggle("reader-nav-visible", shouldShow);
}

function updateReaderNavVisibilityByScroll() {
  const content = document.getElementById("readerContent");
  const activePageElement = state.pageElements[state.currentPageIndex];

  if (!content || !activePageElement) {
    setReaderNavigationVisible(false);
    return;
  }

  const contentRect = content.getBoundingClientRect();
  const pageRect = activePageElement.getBoundingClientRect();
  const reachedBottom = pageRect.bottom <= contentRect.bottom - 12;

  setReaderNavigationVisible(reachedBottom);
}

function getPageNumberFromElement(pageElement, fallbackNumber) {
  const parsed = Number(pageElement?.dataset?.pageNumber || Number.NaN);

  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return fallbackNumber;
}

function syncNavigationControls() {
  const totalPages = state.pageElements.length;
  const hasPrevInChapter = state.currentPageIndex > 0;
  const hasNextInChapter =
    totalPages > 0 && state.currentPageIndex < totalPages - 1;
  const previousHref = state.reader?.pager?.previous?.href || "";
  const nextHref = state.reader?.pager?.next?.href || "";

  ["readerPrevButton", "readerPrevButtonMobile"].forEach((id) => {
    const button = document.getElementById(id);

    if (!button) {
      return;
    }

    button.dataset.href = previousHref;
    button.disabled = !hasPrevInChapter && !previousHref;
  });

  ["readerNextButton", "readerNextButtonMobile"].forEach((id) => {
    const button = document.getElementById(id);

    if (!button) {
      return;
    }

    button.dataset.href = nextHref;
    button.disabled = !hasNextInChapter && !nextHref;
  });
}

function setActivePageIndex(index) {
  const totalPages = state.pageElements.length;

  if (!totalPages) {
    updatePageIndicators("0 / 0");
    syncNavigationControls();
    return;
  }

  const safeIndex = Math.min(Math.max(index, 0), totalPages - 1);
  const pageElement = state.pageElements[safeIndex];
  const pageNumber = getPageNumberFromElement(pageElement, safeIndex + 1);

  state.currentPageIndex = safeIndex;
  updatePageIndicators(`${pageNumber} / ${totalPages}`);
  updateReaderHeaderPage(pageNumber, totalPages);
  updateReaderRoutePage(pageNumber);
  syncNavigationControls();
  updateReaderNavVisibilityByScroll();
}

function getPageIndexByNumber(targetPageNumber) {
  return state.pageElements.findIndex((pageElement) => {
    const pageNumber = getPageNumberFromElement(pageElement, Number.NaN);
    return pageNumber === targetPageNumber;
  });
}

function renderReaderNotFound(message) {
  const chapterList = document.getElementById("readerChapterList");
  const content = document.getElementById("readerContent");

  if (chapterList) {
    chapterList.innerHTML =
      '<p class="empty-state">Tidak ada daftar chapter untuk ditampilkan.</p>';
  }

  if (content) {
    content.innerHTML = `
      <div class="reader-empty">
        <h3>Halaman reader tidak ditemukan</h3>
        <p>${escapeHtml(message || "Coba cek lagi nomor chapter atau panel manga.")}</p>
        <div class="button-row">
          <a class="primary-button" href="/home.html">Kembali ke Dashboard</a>
        </div>
      </div>
    `;
  }

  updatePageIndicators("0 / 0");
  setNavButtonState("readerPrevButton", null);
  setNavButtonState("readerNextButton", null);
  setNavButtonState("readerPrevButtonMobile", null);
  setNavButtonState("readerNextButtonMobile", null);
  state.pageElements = [];
  state.currentPageIndex = 0;
  setReaderNavigationVisible(false);
}

function renderReader(data) {
  const chapterList = document.getElementById("readerChapterList");
  const content = document.getElementById("readerContent");

  state.reader = data;

  // Update header
  updateReaderHeader(data);

  // Update chapter list
  if (chapterList) {
    chapterList.innerHTML = data.chapters
      .map(
        (chapter) => `
          <a
            href="${chapter.href}"
            class="reader-chapter-link ${chapter.isCurrent ? "is-active" : ""}"
            data-reader-link>
            <strong>Chapter ${chapter.chapterNumber}</strong>
          </a>
        `,
      )
      .join("");
  }

  // Render all pages as a long vertical strip
  if (content) {
    const pages = Array.isArray(data.pages) ? data.pages : [data.page];

    content.innerHTML = `
      <div class="reader-stage">
        ${pages
          .map((p) => {
            const imageUrl = String(p.imageUrl || "").trim();

            if (!imageUrl) {
              return `
                  <div class="reader-page-item" data-page-number="${p.pageNumber}">
                    <div class="reader-page-fallback">Panel tidak tersedia</div>
                  </div>
                `;
            }

            return `
                <div class="reader-page-item" data-page-number="${p.pageNumber}">
                  <img
                    src="${escapeHtml(imageUrl)}"
                    loading="lazy"
                    decoding="async"
                    alt="${escapeHtml(`${data.book.title} chapter ${data.chapter.chapterNumber} panel ${p.pageNumber}`)}"
                    class="reader-image" />
                </div>
              `;
          })
          .join("")}
      </div>
    `;

    // Scroll to the requested page in the route
    const target = content.querySelector(
      `[data-page-number="${data.page.pageNumber}"]`,
    );

    if (target) {
      // use instant scroll so user lands on the right panel
      target.scrollIntoView({ behavior: "auto", block: "start" });
    }

    state.pageElements = Array.from(
      content.querySelectorAll(".reader-page-item"),
    );

    const requestedPageIndex = getPageIndexByNumber(data.page.pageNumber);
    setActivePageIndex(requestedPageIndex >= 0 ? requestedPageIndex : 0);

    // Observe page visibility to update active page state.
    if (typeof IntersectionObserver !== "undefined") {
      if (window._otakuPageObserver) {
        window._otakuPageObserver.disconnect();
      }

      const observer = new IntersectionObserver(
        (entries) => {
          const visibleEntries = entries
            .filter((entry) => entry.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

          if (visibleEntries.length === 0) {
            return;
          }

          const activeElement = visibleEntries[0].target;
          const pageNumber = getPageNumberFromElement(activeElement, 1);
          const nextIndex = getPageIndexByNumber(pageNumber);

          if (nextIndex >= 0) {
            setActivePageIndex(nextIndex);
          }
        },
        { root: null, rootMargin: "0px", threshold: 0.6 },
      );

      window._otakuPageObserver = observer;
      content.querySelectorAll(".reader-page-item").forEach((el) => {
        observer.observe(el);
      });
    }
  }

  // Keep chapter-edge fallback href for first/last page transitions.
  setNavButtonState("readerPrevButton", data.pager.previous?.href || null);
  setNavButtonState("readerNextButton", data.pager.next?.href || null);
  setNavButtonState(
    "readerPrevButtonMobile",
    data.pager.previous?.href || null,
  );
  setNavButtonState("readerNextButtonMobile", data.pager.next?.href || null);
  syncNavigationControls();
  updateReaderNavVisibilityByScroll();
}

async function fetchReaderData(route) {
  const response = await fetch(
    `${READER_ENDPOINT}/${encodeURIComponent(route.slug)}/${encodeURIComponent(route.chapter)}/${encodeURIComponent(route.page)}`,
    {
      headers: getAuthHeaders(),
    },
  );

  const result = await parseJsonResponse(response);

  if (response.status === 401) {
    redirectToLogin();
    throw new Error(result.message || "Session berakhir. Silakan login ulang.");
  }

  return {
    ok: response.ok,
    status: response.status,
    result,
  };
}

function startReadingSession() {
  if (!state.reader?.book?.id || !state.reader?.chapter?.id) {
    return;
  }

  state.session = {
    bookId: state.reader.book.id,
    chapterId: state.reader.chapter.id,
    startedAt: Date.now(),
  };
}

async function flushReadingSession(options = {}) {
  const { background = false } = options;
  const currentSession = state.session;

  if (!currentSession?.startedAt) {
    return;
  }

  state.session = null;
  const durationSeconds = Math.floor(
    (Date.now() - currentSession.startedAt) / 1000,
  );

  if (durationSeconds < MIN_SESSION_SECONDS) {
    return;
  }

  const payload = {
    userId: state.currentUser.id,
    chapterId: currentSession.chapterId,
    durationSeconds,
  };
  const url = `${BOOKS_ENDPOINT}/${currentSession.bookId}/reading-sessions`;

  if (background && navigator.sendBeacon) {
    const blob = new Blob([JSON.stringify(payload)], {
      type: "application/json",
    });
    navigator.sendBeacon(url, blob);
    return;
  }

  try {
    await fetch(url, {
      method: "POST",
      headers: getAuthHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(payload),
      keepalive: background,
    });
  } catch (error) {
    console.warn("Gagal menyimpan sesi baca:", error.message);
  }
}

async function navigateToReader(href) {
  if (!href) {
    return;
  }

  await flushReadingSession();
  window.location.assign(href);
}

function scrollToPageByIndex(index) {
  const target = state.pageElements[index];

  if (!target) {
    return false;
  }

  setActivePageIndex(index);
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}

async function handleDirectionalNavigation(direction) {
  const totalPages = state.pageElements.length;

  if (!totalPages || !state.reader) {
    return;
  }

  const nextIndex = state.currentPageIndex + direction;

  if (nextIndex >= 0 && nextIndex < totalPages) {
    scrollToPageByIndex(nextIndex);
    return;
  }

  if (direction > 0 && state.reader?.pager?.next?.href) {
    await navigateToReader(state.reader.pager.next.href);
    return;
  }

  if (direction < 0 && state.reader?.pager?.previous?.href) {
    await navigateToReader(state.reader.pager.previous.href);
  }
}

function attachReaderInteractions() {
  if (state.interactionsAttached) {
    return;
  }

  state.interactionsAttached = true;
  const sidebar = document.getElementById("readerSidebar");
  const menuToggle = document.getElementById("readerChapterMenuToggle");
  const menuClose = document.getElementById("readerChapterMenuClose");
  const readerContent = document.getElementById("readerContent");

  // Sidebar toggle
  if (menuToggle) {
    menuToggle.addEventListener("click", () => {
      sidebar?.classList.toggle("is-open");
    });
  }

  if (menuClose) {
    menuClose.addEventListener("click", () => {
      sidebar?.classList.remove("is-open");
    });
  }

  document.getElementById("readerPrevButton")?.addEventListener("click", () => {
    handleDirectionalNavigation(-1).catch(() => {});
  });
  document
    .getElementById("readerPrevButtonMobile")
    ?.addEventListener("click", () => {
      handleDirectionalNavigation(-1).catch(() => {});
    });
  document.getElementById("readerNextButton")?.addEventListener("click", () => {
    handleDirectionalNavigation(1).catch(() => {});
  });
  document
    .getElementById("readerNextButtonMobile")
    ?.addEventListener("click", () => {
      handleDirectionalNavigation(1).catch(() => {});
    });

  document.body.addEventListener("click", async (event) => {
    const link = event.target.closest("[data-reader-link]");
    const edgeButton = event.target.closest("[data-reader-href]");

    if (edgeButton) {
      const href = edgeButton.dataset.readerHref;

      if (!href) {
        return;
      }

      event.preventDefault();
      await navigateToReader(href);
      return;
    }

    if (!link) {
      return;
    }

    sidebar?.classList.remove("is-open");
    event.preventDefault();
    await navigateToReader(link.getAttribute("href"));
  });

  window.addEventListener("keydown", async (event) => {
    const activeTag = document.activeElement?.tagName?.toLowerCase();

    if (
      activeTag === "input" ||
      activeTag === "textarea" ||
      activeTag === "select"
    ) {
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      await handleDirectionalNavigation(-1);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      await handleDirectionalNavigation(1);
    }

    // Close sidebar on Escape
    if (event.key === "Escape") {
      sidebar?.classList.remove("is-open");
    }
  });

  window.addEventListener("beforeunload", () => {
    flushReadingSession({ background: true }).catch(() => {});
  });

  if (readerContent) {
    readerContent.addEventListener("scroll", () => {
      updateReaderNavVisibilityByScroll();
    });
  }
}

async function initReaderPage() {
  const pageMarker = document.getElementById("readerContent");

  if (!pageMarker) {
    return;
  }

  try {
    await window.OtakuSession.refreshCurrentUserSession();
  } catch (error) {
    console.warn("Reader session refresh warning:", error.message);
  }

  state.currentUser = getCurrentUserSession();

  if (!state.currentUser) {
    redirectToLogin();
    return;
  }

  hydrateReaderIdentity();
  attachReaderInteractions();

  const route = parseReaderRoute();

  if (!route) {
    renderReaderNotFound("Format route reader tidak valid.");
    return;
  }

  try {
    const { ok, status, result } = await fetchReaderData(route);

    if (!ok && status === 404) {
      renderReaderNotFound(result.message);
      return;
    }

    if (!ok) {
      throw new Error(result.message || "Gagal memuat halaman reader.");
    }

    renderReader(result.data);
    startReadingSession();
  } catch (error) {
    renderReaderNotFound(error.message || "Gagal memuat halaman reader.");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initReaderPage();
});
