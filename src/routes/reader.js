const express = require("express");
const { pool } = require("../config/db");
const { resolveRequestUser } = require("../utils/access");

const router = express.Router();

function parsePositiveInteger(rawValue) {
  const parsed = Number.parseInt(String(rawValue || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function createReaderNotFoundResponse(message) {
  return {
    status: "error",
    code: "READER_NOT_FOUND",
    message,
  };
}

router.use(async (req, res, next) => {
  try {
    const { user, error } = await resolveRequestUser(pool, req);

    if (error) {
      return res.status(error.status).json({
        status: "error",
        message: error.message,
      });
    }

    req.user = user;
    return next();
  } catch (error) {
    console.error("Reader auth error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Terjadi kesalahan pada server.",
    });
  }
});

router.get("/manga/:slug/:chapter/:page", async (req, res) => {
  const slug = String(req.params.slug || "")
    .trim()
    .toLowerCase();
  const chapterNumber = parsePositiveInteger(req.params.chapter);
  const pageNumber = parsePositiveInteger(req.params.page);

  if (!slug || !chapterNumber || !pageNumber) {
    return res
      .status(404)
      .json(
        createReaderNotFoundResponse(
          "Halaman reader yang kamu cari tidak ditemukan.",
        ),
      );
  }

  try {
    const [bookRows] = await pool.query(
      `SELECT id,
              title,
              slug,
              author,
              thumbnail_url AS thumbnailUrl,
              description
       FROM books
       WHERE slug = ?
       LIMIT 1`,
      [slug],
    );
    const book = bookRows[0];

    if (!book) {
      return res
        .status(404)
        .json(createReaderNotFoundResponse("Manga tidak ditemukan."));
    }

    const [chapterRows] = await pool.query(
      `SELECT id,
              book_id AS bookId,
              chapter_number AS chapterNumber,
              release_date AS releaseDate,
              page_count AS pageCount,
              preview_image_url AS previewImageUrl
       FROM chapters
       WHERE book_id = ?
       ORDER BY chapter_number ASC, id ASC`,
      [book.id],
    );

    if (chapterRows.length === 0) {
      return res
        .status(404)
        .json(
          createReaderNotFoundResponse(
            "Manga ini belum punya chapter yang bisa dibaca.",
          ),
        );
    }

    const activeChapterIndex = chapterRows.findIndex(
      (chapter) => Number(chapter.chapterNumber) === chapterNumber,
    );

    if (activeChapterIndex === -1) {
      return res
        .status(404)
        .json(createReaderNotFoundResponse("Chapter tidak ditemukan."));
    }

    const activeChapter = chapterRows[activeChapterIndex];
    const [pageRows] = await pool.query(
      `SELECT id,
              chapter_id AS chapterId,
              page_number AS pageNumber,
              image_url AS imageUrl
       FROM chapter_pages
       WHERE chapter_id = ?
       ORDER BY page_number ASC, id ASC`,
      [activeChapter.id],
    );

    if (pageRows.length === 0) {
      return res
        .status(404)
        .json(
          createReaderNotFoundResponse(
            "Chapter ini belum punya panel yang bisa dibaca.",
          ),
        );
    }

    const activePageIndex = pageRows.findIndex(
      (page) => Number(page.pageNumber) === pageNumber,
    );

    if (activePageIndex === -1) {
      return res
        .status(404)
        .json(createReaderNotFoundResponse("Halaman manga tidak ditemukan."));
    }

    const activePage = pageRows[activePageIndex];
    const previousPageInChapter = pageRows[activePageIndex - 1] || null;
    const nextPageInChapter = pageRows[activePageIndex + 1] || null;
    const previousChapter = chapterRows[activeChapterIndex - 1] || null;
    const nextChapter = chapterRows[activeChapterIndex + 1] || null;

    const previousPage =
      (previousPageInChapter
        ? {
            chapterId: activeChapter.id,
            chapterNumber: Number(activeChapter.chapterNumber),
            pageNumber: Number(previousPageInChapter.pageNumber),
          }
        : null) ||
      (previousChapter && Number(previousChapter.pageCount) > 0
        ? {
            chapterId: previousChapter.id,
            chapterNumber: Number(previousChapter.chapterNumber),
            pageNumber: Number(previousChapter.pageCount),
          }
        : null);

    const nextPage =
      (nextPageInChapter
        ? {
            chapterId: activeChapter.id,
            chapterNumber: Number(activeChapter.chapterNumber),
            pageNumber: Number(nextPageInChapter.pageNumber),
          }
        : null) ||
      (nextChapter && Number(nextChapter.pageCount) > 0
        ? {
            chapterId: nextChapter.id,
            chapterNumber: Number(nextChapter.chapterNumber),
            pageNumber: 1,
          }
        : null);

    const buildRoute = (target) =>
      target
        ? `/read/manga/${encodeURIComponent(book.slug)}/${target.chapterNumber}/${target.pageNumber}/`
        : null;

    return res.status(200).json({
      status: "success",
      message: "Halaman reader berhasil dimuat.",
      data: {
        book: {
          id: book.id,
          title: book.title,
          slug: book.slug,
          author: book.author,
          thumbnailUrl: book.thumbnailUrl || null,
          description: book.description || "",
        },
        chapter: {
          id: activeChapter.id,
          chapterNumber: Number(activeChapter.chapterNumber),
          releaseDate: activeChapter.releaseDate || null,
          pageCount: Number(activeChapter.pageCount || pageRows.length),
          previewImageUrl: activeChapter.previewImageUrl || null,
        },
        page: {
          id: activePage.id,
          pageNumber: Number(activePage.pageNumber),
          imageUrl: activePage.imageUrl,
        },
        pager: {
          current: {
            chapterNumber: Number(activeChapter.chapterNumber),
            pageNumber: Number(activePage.pageNumber),
            totalPages: Number(activeChapter.pageCount || pageRows.length),
          },
          previous: previousPage
            ? {
                chapterNumber: previousPage.chapterNumber,
                pageNumber: previousPage.pageNumber,
                href: buildRoute(previousPage),
              }
            : null,
          next: nextPage
            ? {
                chapterNumber: nextPage.chapterNumber,
                pageNumber: nextPage.pageNumber,
                href: buildRoute(nextPage),
              }
            : null,
        },
        chapters: chapterRows.map((chapter) => ({
          id: chapter.id,
          chapterNumber: Number(chapter.chapterNumber),
          releaseDate: chapter.releaseDate || null,
          pageCount: Number(chapter.pageCount || 0),
          previewImageUrl: chapter.previewImageUrl || null,
          href: `/read/manga/${encodeURIComponent(book.slug)}/${Number(
            chapter.chapterNumber,
          )}/1/`,
          isCurrent: chapter.id === activeChapter.id,
        })),
      },
    });
  } catch (error) {
    console.error("Reader detail error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Terjadi kesalahan pada server.",
    });
  }
});

module.exports = router;
