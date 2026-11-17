import { useState, useRef } from "react";
// Importamos la librería oficial de Mozilla para leer y renderizar archivos PDF en el navegador
import * as pdfjsLib from "pdfjs-dist";
// Importamos el "worker" (proceso en segundo plano) para que leer PDFs pesados no congele la pantalla del celular
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// Matriz de precios base por hoja según el tipo de papel y el rango de cobertura de color
const TARIFAS = {
  normal: { bn: 1, color: { bajo: 2, medio: 5, alto: 10 } },
  opalina_delgada: { bn: 2, color: { bajo: 4, medio: 8, alto: 12 } },
  opalina_gruesa: { bn: 3, color: { bajo: 5, medio: 10, alto: 15 } },
  fotografica: { bn: 15, color: { bajo: 30, medio: 45, alto: 60 } },
};

export default function App() {
  // Estados de React para controlar la lista de archivos subidos y la interfaz de carga
  const [archivos, setArchivos] = useState([]);
  const [procesando, setProcesando] = useState(false);
  const [estadoActual, setEstadoActual] = useState("");

  // Referencia directa al elemento <canvas> invisible donde "dibujaremos" cada hoja para medir sus píxeles
  const canvasRef = useRef(null);

  /**
   * Evalúa el costo individual de una sola página.
   * Si no tiene color, cobra tarifa B/N. Si tiene color, clasifica según el porcentaje de tinta.
   */
  const calcularCostoPagina = (cobertura, esColor, tipoPapel) => {
    const precios = TARIFAS[tipoPapel];
    if (!esColor) return precios.bn;

    if (cobertura <= 10) return precios.color.bajo;
    if (cobertura <= 50) return precios.color.medio;
    return precios.color.alto;
  };

  /**
   * Suma el costo de todas las páginas que pertenecen a un mismo archivo (útil para PDFs multipágina).
   */
  const calcularCostoArchivo = (paginas, tipoPapel) => {
    return paginas.reduce(
      (suma, pag) =>
        suma + calcularCostoPagina(pag.cobertura, pag.esColor, tipoPapel),
      0,
    );
  };

  /**
   * MOTOR DE ANÁLISIS DE PÍXELES (Visión artificial básica)
   * Recorre la matriz de imagen dibujada en el canvas y clasifica cada píxel.
   */
  const analizarPixeles = (ctx, width, height) => {
    // Extrae un arreglo gigante con los valores [R, G, B, Alpha] de cada píxel de la imagen
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    let pixelesTinta = 0;
    let pixelesColor = 0;
    const totalPixeles = width * height;

    // Avanzamos de 4 en 4 porque cada píxel ocupa 4 espacios en el arreglo (Rojo, Verde, Azul, Transparencia)
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Si el píxel no es blanco puro (valores menores a 240 para tolerar fondos ligeramente grises o escaneos), cuenta como tinta
      if (r < 240 || g < 240 || b < 240) {
        pixelesTinta++;

        // En escala de grises o negro, R, G y B tienen valores casi idénticos.
        // Si la diferencia entre canales supera 20, significa que el píxel tiene un tono de color real.
        const diferenciaMax = Math.max(
          Math.abs(r - g),
          Math.abs(r - b),
          Math.abs(g - b),
        );
        if (diferenciaMax > 20) {
          pixelesColor++;
        }
      }
    }

    // Calculamos el porcentaje total de la hoja que tiene tinta
    const cobertura = (pixelesTinta / totalPixeles) * 100;
    // Se considera hoja a color solo si más del 0.5% de los píxeles tienen color (evita falsos positivos por ruido)
    const esColor = pixelesColor > totalPixeles * 0.005;

    return { cobertura, esColor };
  };

  /**
   * Procesa archivos de imagen estándar (JPG, PNG, etc.).
   */
  const analizarImagen = (archivo) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = URL.createObjectURL(archivo);
      img.onload = () => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        // Redimensionamos la imagen a un máximo de 800px de ancho para no saturar la memoria RAM del celular
        const maxAncho = 800;
        const escala = img.width > maxAncho ? maxAncho / img.width : 1;
        canvas.width = img.width * escala;
        canvas.height = img.height * escala;

        // Dibujamos la imagen escalada en el canvas y ejecutamos el escáner de píxeles
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const infoPagina = analizarPixeles(ctx, canvas.width, canvas.height);

        resolve({
          id: Math.random().toString(36).substr(2, 9),
          nombre: archivo.name,
          tipoPapel: "normal",
          paginas: [infoPagina],
        });
      };
    });
  };

  /**
   * Procesa documentos PDF página por página de forma secuencial.
   */
  const analizarPDF = async (archivo) => {
    const arrayBuffer = await archivo.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPaginas = pdf.numPages;

    let paginasInfo = [];

    for (let i = 1; i <= numPaginas; i++) {
      setEstadoActual(
        `Procesando ${archivo.name}: Página ${i} de ${numPaginas}...`,
      );

      const pagina = await pdf.getPage(i);
      // Usamos escala 0.5 para renderizar rápido y mantener el consumo de memoria bajo en dispositivos móviles
      const viewport = pagina.getViewport({ scale: 0.5 });

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      // Renderizamos la página del PDF dentro del canvas y analizamos sus píxeles
      await pagina.render({ canvasContext: ctx, viewport: viewport }).promise;
      const infoPagina = analizarPixeles(ctx, canvas.width, canvas.height);
      paginasInfo.push(infoPagina);

      // Limpiamos el canvas inmediatamente después de cada hoja para liberar RAM antes de pasar a la siguiente
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    return {
      id: Math.random().toString(36).substr(2, 9),
      nombre: archivo.name,
      tipoPapel: "normal",
      paginas: paginasInfo,
    };
  };

  /**
   * Controlador principal cuando el usuario selecciona uno o varios archivos desde el botón.
   */
  const manejarSubida = async (evento) => {
    setProcesando(true);
    const nuevosArchivos = Array.from(evento.target.files);

    let resultados = [];
    for (const archivo of nuevosArchivos) {
      if (archivo.type === "application/pdf") {
        const resultadoPDF = await analizarPDF(archivo);
        resultados.push(resultadoPDF);
      } else if (archivo.type.startsWith("image/")) {
        setEstadoActual(`Procesando imagen: ${archivo.name}...`);
        const resultadoImg = await analizarImagen(archivo);
        resultados.push(resultadoImg);
      }
    }

    // Agregamos los nuevos archivos analizados a los que ya estaban en pantalla
    setArchivos((prev) => [...prev, ...resultados]);
    setProcesando(false);
    setEstadoActual("");
    // Limpiamos el input para permitir volver a subir el mismo archivo si el usuario lo borra
    evento.target.value = null;
  };

  /**
   * Actualiza el tipo de papel seleccionado para un archivo específico y recalcula precios automáticamente.
   */
  const cambiarPapelArchivo = (id, nuevoPapel) => {
    setArchivos((prev) =>
      prev.map((arch) =>
        arch.id === id ? { ...arch, tipoPapel: nuevoPapel } : arch,
      ),
    );
  };

  // --- CÁLCULOS GLOBALES DE TODO EL LOTE ---
  const totalPaginasLote = archivos.reduce(
    (suma, arch) => suma + arch.paginas.length,
    0,
  );
  const costoBaseLote = archivos.reduce(
    (suma, arch) => suma + calcularCostoArchivo(arch.paginas, arch.tipoPapel),
    0,
  );

  // Regla de negocio: Si el lote completo suma 50 o más páginas, se descuentan $0.50 por cada hoja
  const descuentoPorVolumen =
    totalPaginasLote >= 50 ? totalPaginasLote * 0.5 : 0;
  const costoTotalLote = costoBaseLote - descuentoPorVolumen;

  // --- INTERFAZ VISUAL (JSX) ---
  return (
    <div
      style={{
        padding: "20px",
        fontFamily: "sans-serif",
        textAlign: "center",
        backgroundColor: "#1e1e1e",
        color: "#fff",
        minHeight: "100vh",
      }}
    >
      <h2>Cotizador Dinámico de Tinta</h2>

      {/* Botón estilizado que oculta el input nativo de archivos */}
      <label
        style={{
          display: "inline-block",
          background: procesando ? "#555" : "#007BFF",
          color: "white",
          padding: "12px 24px",
          borderRadius: "5px",
          cursor: procesando ? "not-allowed" : "pointer",
          marginBottom: "20px",
        }}
      >
        {procesando ? "Analizando documento..." : "+ Seleccionar Fotos / PDFs"}
        <input
          type="file"
          multiple
          accept="image/*, application/pdf"
          style={{ display: "none" }}
          onChange={manejarSubida}
          disabled={procesando}
        />
      </label>

      {/* Indicador de progreso en tiempo real para PDFs largos */}
      {procesando && (
        <p style={{ color: "#ffeb3b", fontWeight: "bold" }}>{estadoActual}</p>
      )}

      {/* Lienzo oculto donde ocurre todo el procesamiento matemático de imágenes */}
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* Lista de tarjetas por cada archivo subido */}
      <div
        style={{
          marginTop: "20px",
          textAlign: "left",
          maxWidth: "500px",
          margin: "0 auto",
        }}
      >
        {archivos.map((archivo) => {
          const costoArchivo = calcularCostoArchivo(
            archivo.paginas,
            archivo.tipoPapel,
          );
          const tieneColor = archivo.paginas.some((p) => p.esColor);
          const coberturaPromedio = (
            archivo.paginas.reduce((s, p) => s + p.cobertura, 0) /
            archivo.paginas.length
          ).toFixed(2);

          return (
            <div
              key={archivo.id}
              style={{ borderBottom: "1px solid #444", padding: "15px 0" }}
            >
              <p style={{ margin: "0 0 10px 0", fontWeight: "bold" }}>
                {archivo.nombre.endsWith(".pdf") ? "📕" : "📄"} {archivo.nombre}
              </p>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                {/* Selector individual de tipo de papel */}
                <select
                  value={archivo.tipoPapel}
                  onChange={(e) =>
                    cambiarPapelArchivo(archivo.id, e.target.value)
                  }
                  style={{
                    padding: "5px",
                    borderRadius: "4px",
                    backgroundColor: "#222",
                    color: "#fff",
                    border: "1px solid #555",
                  }}
                >
                  <option value="normal">Hoja Normal</option>
                  <option value="opalina_delgada">Opalina Delgada</option>
                  <option value="opalina_gruesa">Opalina Gruesa</option>
                  <option value="fotografica">Fotográfica</option>
                </select>

                <p
                  style={{
                    margin: "0",
                    color: "#4CAF50",
                    fontSize: "20px",
                    fontWeight: "bold",
                  }}
                >
                  ${costoArchivo.toFixed(2)}
                </p>
              </div>

              {/* Resumen técnico de páginas, cobertura promedio y detección de color */}
              <p
                style={{ margin: "8px 0 0 0", color: "#aaa", fontSize: "13px" }}
              >
                {archivo.paginas.length > 1
                  ? `${archivo.paginas.length} páginas | `
                  : ""}
                Cob. Promedio: {coberturaPromedio}% |
                <span
                  style={{
                    color: tieneColor ? "#4fc3f7" : "#fff",
                    marginLeft: "4px",
                  }}
                >
                  {tieneColor ? "Contiene Color" : "Blanco y Negro"}
                </span>
              </p>
            </div>
          );
        })}
      </div>

      {/* Caja de resumen final y botón para reiniciar la cotización */}
      {archivos.length > 0 && (
        <div
          style={{
            marginTop: "30px",
            padding: "15px",
            background: "#222",
            borderRadius: "8px",
            maxWidth: "500px",
            margin: "30px auto",
            boxShadow: "0 4px 6px rgba(0,0,0,0.3)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: "10px",
            }}
          >
            <h3 style={{ margin: 0, color: "#fff", fontSize: "18px" }}>
              Páginas totales:
            </h3>
            <span style={{ fontSize: "18px", fontWeight: "bold" }}>
              {totalPaginasLote}
            </span>
          </div>

          {/* Solo se muestra si el lote alcanzó las 50 páginas */}
          {descuentoPorVolumen > 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: "10px",
                color: "#ffeb3b",
              }}
            >
              <p style={{ margin: 0, fontSize: "16px" }}>
                Descuento (Mayoreo):
              </p>
              <span style={{ fontSize: "16px", fontWeight: "bold" }}>
                -${descuentoPorVolumen.toFixed(2)}
              </span>
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginTop: "15px",
              borderTop: "1px solid #444",
              paddingTop: "15px",
            }}
          >
            <h3 style={{ margin: 0, color: "#4CAF50", fontSize: "24px" }}>
              Total a cobrar:
            </h3>
            <span
              style={{ color: "#4CAF50", fontSize: "28px", fontWeight: "bold" }}
            >
              ${costoTotalLote.toFixed(2)}
            </span>
          </div>

          <button
            onClick={() => setArchivos([])}
            style={{
              marginTop: "20px",
              width: "100%",
              padding: "12px 15px",
              background: "#d32f2f",
              color: "#fff",
              border: "none",
              borderRadius: "5px",
              cursor: "pointer",
              fontWeight: "bold",
              fontSize: "16px",
            }}
          >
            Nueva Cotización
          </button>
        </div>
      )}
    </div>
  );
}
