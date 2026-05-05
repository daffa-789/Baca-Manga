const READER_ENDPOINT = "/api/reader/manga";
const BOOKS_ENDPOINT = "/api/books";
const MIN_SESSION_SECONDS = 5;

const state = {
  currentUser: null,
  reader: null,
  session: null,
  drawerOpen: false,
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
  const headers = {
    ...baseHeaders,
    "x-user-id": String(state.currentUser.id),
  };

  if (state.currentUser?.token) {
    headers.Authorization = `Bearer ${state.currentUser.token}`;
  }

  return headers;
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

  updatePageIndicators("Panel - / -");
  setNavButtonState("readerPrevButtonMobile", null);
  setNavButtonState("readerNextButtonMobile", null);
}

function renderReader(data) {
  const chapterList = document.getElementById("readerChapterList");
  const content = document.getElementById("readerContent");
  const pageLabel = `Panel ${data.page.pageNumber} / ${data.chapter.pageCount}`;

  state.reader = data;

  if (chapterList) {
    chapterList.innerHTML = data.chapters
      .map(
        (chapter) => `
          <a
            href="${chapter.href}"
            class="reader-chapter-link ${chapter.isCurrent ? "is-active" : ""}"
            data-reader-link>
            <div>
              <strong>Chapter ${chapter.chapterNumber}</strong>
            </div>
            <span>${chapter.pageCount} panel</span>
          </a>
        `,
      )
      .join("");
  }

  if (content) {
    content.innerHTML = `
      <div class="reader-stage">
        <div class="reader-image-wrap">
          ${renderImageWithFallback(
            data.page.imageUrl,
            `${data.book.title} chapter ${data.chapter.chapterNumber} panel ${data.page.pageNumber}`,
            "Panel tidak tersedia",
            "reader-page-fallback",
          )}
        </div>
        <div class="reader-nav-controls">
          <button
            id="readerPrevButtonMobile"
            class="reader-nav-button"
            type="button"
            aria-label="Halaman sebelumnya">
            <i class="bi bi-chevron-left" aria-hidden="true"></i>
          </button>
          <button
            id="readerNextButtonMobile"
            class="reader-nav-button"
            type="button"
            aria-label="Halaman berikutnya">
            <i class="bi bi-chevron-right" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    `;
  }

  updatePageIndicators(pageLabel);
  setNavButtonState(
    "readerPrevButtonMobile",
    data.pager.previous?.href || null,
  );
  setNavButtonState("readerNextButtonMobile", data.pager.next?.href || null);
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

function attachReaderInteractions() {
  ["readerPrevButtonMobile", "readerNextButtonMobile"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", async () => {
      const href = document.getElementById(id)?.dataset.href;

      if (href) {
        await navigateToReader(href);
      }
    });
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

    if (event.key === "ArrowLeft" && state.reader?.pager?.previous?.href) {
      event.preventDefault();
      await navigateToReader(state.reader.pager.previous.href);
      return;
    }

    if (event.key === "ArrowRight" && state.reader?.pager?.next?.href) {
      event.preventDefault();
      await navigateToReader(state.reader.pager.next.href);
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
    attachReaderInteractions();
    startReadingSession();
  } catch (error) {
    renderReaderNotFound(error.message || "Gagal memuat halaman reader.");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initReaderPage();
});
