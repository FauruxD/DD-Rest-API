const express = require("express");
const swaggerUi = require("swagger-ui-express");
const swaggerJsDoc = require("swagger-jsdoc");
const loadEnv = require("./utils/loadEnv");

loadEnv();

if (process.env.NODE_ENV !== "production") {
  console.log("Using Komiktap cookie:", Boolean(process.env.KOMIKTAP_COOKIE || process.env.DOUJINDESU_COOKIE));
}

// Tambahkan penanganan error global
process.on("uncaughtException", (err) => {
  console.error("Ada error yang tidak tertangkap:", err);
  // Tidak exit process agar aplikasi tetap berjalan
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  // Tidak exit process agar aplikasi tetap berjalan
});

const app = express();
const port = process.env.PORT || 3001;
const rateLimiter = require("./middleware/rateLimiter");
const apiRoute = require("./routes/api");
const { closeBrowser } = require("./utils/browser");

app.use(rateLimiter);
app.use(express.json());

// Middleware for CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});

const swaggerOptions = {
  swaggerDefinition: {
    openapi: "3.0.0",
    info: {
      title: "Komiktap Rest API",
      version: "1.0.0",
      description: "API untuk mengambil data komik dari Komiktap",
    },
    servers: [
      {
        url: process.env.PUBLIC_URL || `http://localhost:${port}`,
      },
    ],
  },
  apis: ["./routes/*.js"],
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));

const rekomendasiRoute = require("./routes/rekomendasi");
const terbaruRoute = require("./routes/terbaru");
const pustakaRouter = require("./routes/pustaka");
const komikPopulerRoute = require("./routes/komik-populer");
const detailKomikRoute = require("./routes/detail-komik");
const bacaChapterRoute = require("./routes/baca-chapter");
const searchRoute = require("./routes/search");
const berwarnaRoute = require("./routes/berwarna");
const genreAll = require("./routes/genre-all");
const genreDetail = require("./routes/genre-detail");
const genreRekomendasi = require("./routes/genre-rekomendasi");

// Root route
app.get("/", (req, res) => {
  res.json({
    name: "Komiktap REST API",
    version: "1.0.0",
    source: "https://komiktap.info",
    endpoints: [
      "/api/home",
      "/api/doujin",
      "/api/manga",
      "/api/manhwa",
      "/api/manhua",
      "/api/library",
      "/api/detail/:slug",
      "/api/chapter/:slug",
      "/api/genres",
      "/api/genre/:slug",
      "/api/search?q=keyword",
      "/api/popular",
    ],
  });
});

app.use("/api", apiRoute);

app.use("/rekomendasi", rekomendasiRoute);
app.use("/terbaru", terbaruRoute);
app.use("/pustaka", pustakaRouter);
app.use("/manga", pustakaRouter);
app.use("/komik-populer", komikPopulerRoute);
app.use("/detail-komik", detailKomikRoute);
app.use("/baca-chapter", bacaChapterRoute);
app.use("/search", searchRoute);
app.use("/berwarna", berwarnaRoute);
app.use("/genre-all", genreAll);
app.use("/genre-rekomendasi", genreRekomendasi);
app.use("/genre", genreDetail);

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server jalan di http://localhost:${port}`);
  });
}

["SIGINT", "SIGTERM"].forEach((signal) => {
  process.on(signal, async () => {
    await closeBrowser().catch(() => {});
    process.exit(0);
  });
});

module.exports = app;
