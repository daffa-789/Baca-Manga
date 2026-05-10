const READER_ENDPOINT = "/api/reader/manga";
const BOOKS_ENDPOINT = "/api/books";
const MIN_SESSION_SECONDS = 5;

const state = {
  currentUser: null,
  reader: null,
  session: null,
  pageElements: [],
  currentPageIndex: 0,
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

function syncReaderHeaderControls() {
  const isCollapsed = document.body.classList.contains(
    "reader-header-collapsed",
  );
  const headerRestore = document.getElementById("readerHeaderRestore");

  if (headerRestore) {
    headerRestore.setAttribute("aria-hidden", isCollapsed ? "false" : "true");
  }
}

function updateReaderHeader(data) {
  const bookTitle = document.getElementById("readerBookTitle");

  if (bookTitle) {
    bookTitle.textContent = escapeHtml(data.book.title);
  }
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

function showCurrentPage() {
  const totalPages = state.pageElements.length;

  if (!totalPages) {
    return;
  }

  state.pageElements.forEach((page, index) => {
    page.style.display = index === state.currentPageIndex ? "flex" : "none";
  });

  const pageNumber = state.currentPageIndex + 1;
  updateReaderRoutePage(pageNumber);
  syncNavigationControls();
}

function setActivePageIndex(index) {
  const totalPages = state.pageElements.length;

  if (!totalPages) {
    syncNavigationControls();
    return;
  }

  const safeIndex = Math.min(Math.max(index, 0), totalPages - 1);

  state.currentPageIndex = safeIndex;
  showCurrentPage();
}

function renderReaderNotFound(message) {
  const rightChapterList = document.getElementById("readerRightChapterList");
  const content = document.getElementById("readerContent");
  const emptyChapterMessage =
    '<p class="empty-state">Tidak ada daftar chapter untuk ditampilkan.</p>';

  if (rightChapterList) {
    rightChapterList.innerHTML = emptyChapterMessage;
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

  state.pageElements = [];
  state.currentPageIndex = 0;
}

function renderReader(data) {
  const rightChapterList = document.getElementById("readerRightChapterList");
  const content = document.getElementById("readerContent");

  state.reader = data;

  updateReaderHeader(data);

  const chaptersHtml = data.chapters
    .map(
      (chapter) => `
        <a
          href="${chapter.href}"
          class="reader-chapter-item ${chapter.isCurrent ? "active" : ""}"
          data-reader-link>
          <strong>Chapter ${chapter.chapterNumber}</strong>
        </a>
      `,
    )
    .join("");

  if (rightChapterList) {
    rightChapterList.innerHTML = chaptersHtml;
  }

  if (content) {
    const pagesHtml = data.pages
      .map(
        (page) => `
          <div class="reader-page-item" data-page-number="${page.pageNumber}">
            <img
              src="${page.imageUrl}"
              alt="Page ${page.pageNumber}"
              class="reader-image"
              loading="eager" />
          </div>
        `,
      )
      .join("");

    content.innerHTML = pagesHtml;
  }

  state.pageElements = Array.from(
    document.querySelectorAll(".reader-page-item"),
  );

  const route = parseReaderRoute();
  const initialPageNumber = Number.parseInt(route?.page || "1", 10);
  const initialPageIndex = initialPageNumber - 1;

  setActivePageIndex(initialPageIndex >= 0 ? initialPageIndex : 0);
}

async function fetchReaderData(route) {
  const url = `${READER_ENDPOINT}/${route.slug}/${route.chapter}/${route.page}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: getAuthHeaders(),
    });

    const result = await parseJsonResponse(response);

    return {
      ok: response.ok,
      status: response.status,
      result,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      result: { message: error.message },
    };
  }
}

async function navigateToReader(href) {
  if (!href) {
    return;
  }

  window.location.href = href;
}

async function handleDirectionalNavigation(direction) {
  const totalPages = state.pageElements.length;

  if (!totalPages) {
    return;
  }

  const nextIndex = state.currentPageIndex + direction;

  if (nextIndex >= 0 && nextIndex < totalPages) {
    setActivePageIndex(nextIndex);
    return;
  }

  if (direction < 0 && state.reader?.pager?.previous?.href) {
    await navigateToReader(state.reader.pager.previous.href);
    return;
  }

  if (direction > 0 && state.reader?.pager?.next?.href) {
    await navigateToReader(state.reader.pager.next.href);
  }
}

async function startReadingSession() {
  if (!state.reader) {
    return;
  }

  const { book, chapter } = state.reader;

  state.session = {
    bookId: book.id,
    chapterId: chapter.id,
    startedAt: Date.now(),
  };
}

async function flushReadingSession(options = {}) {
  if (!state.session) {
    return;
  }

  const elapsed = Math.floor((Date.now() - state.session.startedAt) / 1000);

  if (elapsed < MIN_SESSION_SECONDS) {
    return;
  }

  const payload = {
    bookId: state.session.bookId,
    chapterId: state.session.chapterId,
    durationSeconds: elapsed,
  };

  try {
    const response = await fetch(BOOKS_ENDPOINT, {
      method: "POST",
      headers: getAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
      keepalive: options.background || false,
    });

    if (!response.ok) {
      console.warn("Failed to flush reading session");
    }
  } catch (error) {
    console.warn("Error flushing reading session:", error.message);
  }

  state.session.startedAt = Date.now();
}

function attachReaderInteractions() {
  const rightSidebar = document.getElementById("readerRightSidebar");
  const rightSidebarClose = document.getElementById("readerRightClose");
  const readerContent = document.getElementById("readerContent");
  const rightToggle = document.getElementById("readerRightToggle");
  const headerToggle = document.getElementById("readerHeaderToggle");

  if (rightToggle && rightSidebar) {
    rightToggle.addEventListener("click", () => {
      rightSidebar.classList.toggle("is-open");
    });
  }

  if (rightSidebarClose && rightSidebar) {
    rightSidebarClose.addEventListener("click", () => {
      rightSidebar.classList.remove("is-open");
    });
  }

  if (headerToggle) {
    headerToggle.addEventListener("click", () => {
      document.body.classList.toggle("reader-header-collapsed");
      syncReaderHeaderControls();
    });
  }

  const headerRestore = document.getElementById("readerHeaderRestore");

  if (headerRestore) {
    headerRestore.addEventListener("click", () => {
      document.body.classList.remove("reader-header-collapsed");
      syncReaderHeaderControls();
    });
  }

  ["readerPrevButton", "readerPrevButtonMobile"].forEach((id) => {
    const button = document.getElementById(id);

    if (!button) {
      return;
    }

    button.addEventListener("click", async () => {
      if (button.disabled) {
        return;
      }

      const href = button.dataset.href;

      if (href) {
        await navigateToReader(href);
      } else {
        await handleDirectionalNavigation(-1);
      }
    });
  });

  ["readerNextButton", "readerNextButtonMobile"].forEach((id) => {
    const button = document.getElementById(id);

    if (!button) {
      return;
    }

    button.addEventListener("click", async () => {
      if (button.disabled) {
        return;
      }

      const href = button.dataset.href;

      if (href) {
        await navigateToReader(href);
      } else {
        await handleDirectionalNavigation(1);
      }
    });
  });

  if (readerContent) {
    readerContent.addEventListener("click", (event) => {
      if (event.target.closest("button, a, [data-reader-link]")) {
        return;
      }

      const rect = readerContent.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const width = rect.width;
      const leftThird = width / 3;
      const rightThird = (width * 2) / 3;

      if (clickX < leftThird) {
        handleDirectionalNavigation(-1);
      } else if (clickX > rightThird) {
        handleDirectionalNavigation(1);
      }
    });
  }

  document.body.addEventListener("click", async (event) => {
    const link = event.target.closest("[data-reader-link]");

    if (!link) {
      return;
    }

    rightSidebar?.classList.remove("is-open");
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

    if (event.key === "Escape") {
      rightSidebar?.classList.remove("is-open");
    }
  });

  window.addEventListener("beforeunload", () => {
    flushReadingSession({ background: true }).catch(() => {});
  });
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
  document.body.classList.add("reader-nav-visible");
  syncReaderHeaderControls();
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
