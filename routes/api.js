const express = require("express");
const {
  getChapter,
  getComics,
  getDetail,
  getDoujin,
  getGenreDetail,
  getGenres,
  getHome,
  getLibrary,
  getManga,
  getManhwa,
  getManhua,
  getPopular,
  getSearch,
} = require("../controllers/doujindesuApiController");

const router = express.Router();

router.get("/doujin", getDoujin);
router.get("/manga", getManga);
router.get("/manhwa", getManhwa);
router.get("/manhua", getManhua);
router.get("/library", getLibrary);
router.get("/home", getHome);
router.get("/comics", getComics);
router.get("/genres", getGenres);
router.get("/genres/:slug", getGenreDetail);
router.get("/genre/:slug", getGenreDetail);
router.get("/detail/:slug", getDetail);
router.get("/chapter/:slug/:chapter", getChapter);
router.get("/chapter/:slug", getChapter);
router.get("/search", getSearch);
router.get("/populer", getPopular);
router.get("/popular", getPopular);

module.exports = router;
