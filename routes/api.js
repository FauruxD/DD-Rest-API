const express = require("express");
const {
  getChapter,
  getDetail,
  getDoujin,
  getGenreDetail,
  getGenres,
  getHome,
  getLibrary,
  getManga,
  getManhwa,
  getPopular,
  getSearch,
} = require("../controllers/doujindesuApiController");

const router = express.Router();

router.get("/doujin", getDoujin);
router.get("/manga", getManga);
router.get("/manhwa", getManhwa);
router.get("/library", getLibrary);
router.get("/home", getHome);
router.get("/genres", getGenres);
router.get("/genre/:slug", getGenreDetail);
router.get("/detail/:slug", getDetail);
router.get("/chapter/:slug", getChapter);
router.get("/search", getSearch);
router.get("/popular", getPopular);

module.exports = router;
