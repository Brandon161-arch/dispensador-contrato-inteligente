(() => {
  "use strict";

  const CONFIG = window.CONTRATO_DISPENSADOR || null;
  const WEI = 10n ** 18n;

  const CATALOGO = [
    { nombre: "Empanada", precio: "0.002", stock: 10, emoji: "🥟" },
    { nombre: "Arepa de queso", precio: "0.003", stock: 8, emoji: "🫓" },
    { nombre: "Mango", precio: "0.001", stock: 12, emoji: "🥭" },
    { nombre: "Chocolate", precio: "0.0015", stock: 15, emoji: "🍫" },
    { nombre: "Papas", precio: "0.002", stock: 9, emoji: "🍟" },
    { nombre: "Limonada", precio: "0.0025", stock: 7, emoji: "🥤" },
  ];

  const ERRORES = {
    PagoInsuficiente: "El pago no alcanza el precio. No se descontó nada.",
    SinStock: "Ese producto ya se agotó.",
    ProductoInexistente: "Ese producto no existe en la máquina.",
    SoloDueno: "Solo la cuenta dueña puede hacer esa acción.",
    SinGanancias: "No hay fondos para retirar.",
    CantidadInvalida: "La cantidad debe ser mayor que cero.",
    FalloAlEnviar: "No se pudo enviar el cambio.",
    NoAceptaPagosDirectos: "La máquina solo acepta pagos con una compra.",
    SaldoInsuficiente: "Tu saldo demo no alcanza. Recarga o paga menos.",
    MontoInvalido: "Escribe un monto mayor que cero, por ejemplo 0,002.",
    FirmaCancelada: "Cancelaste la firma. No se envió nada.",
    ErrorDeRed: "La billetera devolvió un error inesperado.",
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const estado = {
    modo: "demo",
    productos: [],
    seleccionado: 0,
    saldoWei: 0n,
    custodiaWei: 0n,
    ventas: 0,
    recibo: null,
    ocupado: false,
    cuenta: null,
    dueno: null,
    contrato: null,
    provider: null,
    listeners: false,
  };

  let toastTimer = null;

  /* Dinero */
  function parseEth(valor) {
    if (typeof valor === "bigint") return valor;
    const crudo = String(valor ?? "").trim().replace(",", ".");
    if (!/^\d*(?:\.\d*)?$/.test(crudo) || crudo === "" || crudo === ".") return null;
    const [entera = "0", decimal = ""] = crudo.split(".");
    if (decimal.length > 18) return null;
    const decimales = (decimal + "0".repeat(18)).slice(0, 18);
    try {
      return BigInt(entera || "0") * WEI + BigInt(decimales || "0");
    } catch {
      return null;
    }
  }

  function formatEth(wei, maximo = 4) {
    if (wei === null || wei === undefined) return "—";
    let valor = BigInt(wei);
    const negativo = valor < 0n;
    if (negativo) valor = -valor;
    const entera = valor / WEI;
    const decimal = (valor % WEI).toString().padStart(18, "0").slice(0, maximo).replace(/0+$/, "");
    return `${negativo ? "−" : ""}${entera}${decimal ? `,${decimal}` : ""} ETH`;
  }

  function ethInput(wei) {
    const valor = BigInt(wei);
    const entera = valor / WEI;
    const decimal = (valor % WEI).toString().padStart(18, "0").replace(/0+$/, "");
    return decimal ? `${entera}.${decimal}` : `${entera}`;
  }

  function corto(hash) {
    if (!hash) return "—";
    return hash.length > 14 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
  }

  function escapar(valor) {
    return String(valor).replace(/[&<>"']/g, (c) => {
      const mapa = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
      return mapa[c];
    });
  }

  /* Avisos */
  function anunciar(texto) {
    $("#anuncio").textContent = "";
    window.setTimeout(() => {
      $("#anuncio").textContent = texto;
    }, 40);
  }

  function toast(texto) {
    const elemento = $("#toast");
    elemento.textContent = texto;
    elemento.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => elemento.classList.remove("is-visible"), 3200);
  }

  function mensaje(texto, tono = "") {
    const elemento = $("#caja-msg");
    elemento.textContent = texto;
    elemento.className = `message${tono ? ` is-${tono}` : ""}`;
  }

  function pantalla(principal, secundario, tono = "") {
    $("#lcd-estado").textContent = String(principal).toUpperCase();
    $("#lcd-sub").textContent = secundario;
    const pantallaElemento = $(".machine-screen");
    pantallaElemento.className = `machine-screen${tono ? ` is-${tono}` : ""}`;
  }

  function entregar(emoji, texto) {
    const slot = $("#tray-emoji");
    slot.textContent = emoji;
    slot.classList.remove("is-dropping");
    void slot.offsetWidth;
    slot.classList.add("is-dropping");
    $("#tray-label").textContent = texto;
  }

  function reiniciarBandeja() {
    $("#tray-emoji").textContent = "—";
    $("#tray-label").textContent = "Bandeja de entrega";
  }

  /* Productos */
  function productosBase() {
    return CATALOGO.map((producto, id) => ({
      id,
      nombre: producto.nombre,
      precioWei: parseEth(producto.precio),
      stock: producto.stock,
      emoji: producto.emoji,
    }));
  }

  function productoActual() {
    return estado.productos.find((producto) => producto.id === estado.seleccionado) || estado.productos[0] || null;
  }

  function seleccionar(id) {
    const producto = estado.productos.find((item) => item.id === id);
    if (!producto) return;
    estado.seleccionado = producto.id;
    $("#monto").value = ethInput(producto.precioWei);
    mensaje(`Elegiste ${producto.nombre}. El pago exacto ya está listo.`, "");
    pantalla(producto.nombre, `${producto.stock} disponibles`);
    render();
  }

  function renderProductos() {
    const contenedor = $("#productos");
    if (contenedor.children.length !== estado.productos.length) {
      contenedor.innerHTML = "";
      estado.productos.forEach((producto) => {
        const boton = document.createElement("button");
        boton.type = "button";
        boton.className = "product";
        boton.innerHTML =
          '<span class="product-emoji" aria-hidden="true"></span>' +
          '<span class="product-name"></span>' +
          '<span class="product-price"></span>' +
          '<span class="product-stock"></span>';
        boton.addEventListener("click", () => seleccionar(producto.id));
        contenedor.appendChild(boton);
      });
    }

    estado.productos.forEach((producto, indice) => {
      const boton = contenedor.children[indice];
      if (!boton) return;
      const agotado = producto.stock === 0;
      boton.className =
        "product" +
        (producto.id === estado.seleccionado ? " is-selected" : "") +
        (agotado ? " is-sold" : "");
      boton.setAttribute("aria-pressed", producto.id === estado.seleccionado ? "true" : "false");
      boton.setAttribute(
        "aria-label",
        `${producto.nombre}, ${formatEth(producto.precioWei)}, ${agotado ? "agotado" : `${producto.stock} disponibles`}`
      );
      boton.querySelector(".product-emoji").textContent = producto.emoji;
      boton.querySelector(".product-name").textContent = producto.nombre;
      boton.querySelector(".product-price").textContent = formatEth(producto.precioWei);
      boton.querySelector(".product-stock").textContent = agotado ? "Agotado" : `${producto.stock} disp.`;
    });
  }

  /* Render */
  function render() {
    renderProductos();
    renderPedido();
    renderRecibo();
    renderWallet();
    renderOwner();
    actualizarPreview();
  }

  function renderPedido() {
    const producto = productoActual();
    if (!producto) return;

    $("#sel-emoji").textContent = producto.emoji;
    $("#sel-nombre").textContent = producto.nombre;
    $("#sel-precio").textContent = formatEth(producto.precioWei);
    $("#sel-stock").textContent = producto.stock > 0 ? `${producto.stock} unidades` : "Agotado";
    $("#saldo-label").textContent = estado.modo === "real" ? "Saldo en wallet" : "Saldo demo";
    $("#saldo-demo").textContent = formatEth(estado.saldoWei);

    const pill = $("#stock-pill");
    pill.textContent = producto.stock > 0 ? `${producto.stock} disponibles` : "Agotado";
    pill.className = `soft-pill${producto.stock > 0 ? " is-ok" : " is-bad"}`;

    const boton = $("#btn-comprar");
    boton.disabled = estado.ocupado || producto.stock === 0 || (estado.modo === "real" && !estado.contrato);
    boton.textContent = estado.ocupado
      ? "Procesando…"
      : estado.modo === "real"
        ? "Comprar y firmar"
        : `Comprar por ${formatEth(producto.precioWei)}`;

    $("#btn-saldo").hidden = estado.modo === "real";
    $("#btn-reiniciar").hidden = estado.modo === "real";
    $("#monto").disabled = estado.ocupado;
    $("#contrato-address").textContent = CONFIG?.address
      ? corto(CONFIG.address)
      : "Sin desplegar · modo demo";
  }

  function renderRecibo() {
    const pill = $("#recibo-estado");
    const cuerpo = $("#recibo-body");
    const recibo = estado.recibo;

    if (!recibo) {
      pill.className = "soft-pill";
      pill.textContent = "Sin compras";
      cuerpo.innerHTML = '<p class="empty">Tu última compra aparecerá aquí.</p>';
      return;
    }

    if (!recibo.ok) {
      pill.className = "soft-pill is-bad";
      pill.textContent = "Rechazada";
      cuerpo.innerHTML = `
        <div class="receipt-fail">
          <strong>Compra cancelada · ${escapar(recibo.codigo)}</strong>
          <p>${escapar(recibo.detalle)}</p>
        </div>`;
      return;
    }

    pill.className = "soft-pill is-ok";
    pill.textContent = "Confirmada";
    const filas = [
      ["Producto", `${recibo.emoji} ${recibo.producto}`],
      ["Precio", formatEth(recibo.precio)],
      ["Pagaste", formatEth(recibo.pagado)],
      ["Cambio", formatEth(recibo.cambio)],
      ["Quedan", `${recibo.stock} unidades`],
      ["Venta", `#${recibo.venta}`],
    ];
    cuerpo.innerHTML = `
      <dl class="receipt-rows">
        ${filas
          .map(
            ([etiqueta, valor], indice) =>
              `<div><dt>${escapar(etiqueta)}</dt><dd class="${indice === 3 ? "is-change" : ""}">${escapar(
                valor
              )}</dd></div>`
          )
          .join("")}
      </dl>`;
  }

  function renderWallet() {
    const esReal = estado.modo === "real";
    const chip = $("#net-chip");
    chip.className = `status-pill ${esReal ? "is-real" : "is-demo"}`;
    $("#net-label").textContent = esReal ? "Hardhat local" : "Modo demo";

    const linea = $(".wallet-line");
    linea.classList.toggle("is-real", esReal);
    $("#wallet-text").textContent = esReal
      ? `Conectado · ${corto(estado.cuenta)}`
      : "Modo demo · no se firma nada";

    const boton = $("#btn-conectar");
    if (esReal) {
      boton.textContent = "Volver a demo";
      boton.disabled = estado.ocupado;
    } else if (!CONFIG?.address) {
      boton.textContent = "Solo demo";
      boton.disabled = true;
    } else if (!window.ethereum) {
      boton.textContent = "Instalar MetaMask";
      boton.disabled = false;
    } else {
      boton.textContent = "Conectar MetaMask";
      boton.disabled = estado.ocupado;
    }
  }

  function esDueno() {
    if (estado.modo !== "real") return true;
    if (!estado.cuenta || !estado.dueno) return false;
    return estado.cuenta.toLowerCase() === estado.dueno.toLowerCase();
  }

  function mensajeDueno(texto, tono = "") {
    const elemento = $("#owner-msg");
    elemento.textContent = texto;
    elemento.className = `message${tono ? ` is-${tono}` : ""}`;
  }

  function renderOwner() {
    const autorizado = esDueno();
    const rol = $("#owner-role");
    rol.className = `soft-pill ${autorizado ? "is-ok" : "is-bad"}`;
    rol.textContent =
      estado.modo === "real"
        ? autorizado
          ? "Dueño verificado"
          : "Solo lectura"
        : "Dueño · demo";

    $("#owner-note").textContent =
      estado.modo === "real"
        ? autorizado
          ? "Tu cuenta es la dueña del contrato. Cada acción se firma con MetaMask."
          : "La cuenta conectada no es la dueña. Puedes comprar, pero no administrar."
        : "En modo demo actúas como dueño. En la red, solo la cuenta que desplegó el contrato puede administrar.";

    const contenedor = $("#owner-productos");
    contenedor.innerHTML = estado.productos
      .map(
        (producto) => `
          <div class="owner-row${producto.stock === 0 ? " is-out" : ""}">
            <span class="owner-emoji" aria-hidden="true">${producto.emoji}</span>
            <div class="owner-info">
              <strong>${escapar(producto.nombre)}</strong>
              <small>${producto.stock} unidades</small>
            </div>
            <button class="btn-mini" type="button" data-id="${producto.id}"
              aria-label="Reponer 5 unidades de ${escapar(producto.nombre)}">+5</button>
          </div>`
      )
      .join("");

    $$("#owner-productos .btn-mini").forEach((boton) => {
      boton.disabled = !autorizado || estado.ocupado;
    });

    const totalStock = estado.productos.reduce((total, producto) => total + producto.stock, 0);
    $("#custodia").textContent = formatEth(estado.custodiaWei);
    $("#owner-ventas").textContent = String(estado.ventas);
    $("#owner-stock-total").textContent = `${totalStock} uds.`;

    const cashPill = $("#owner-cash-pill");
    const hayFondos = estado.custodiaWei > 0n;
    cashPill.textContent = hayFondos ? "En custodia" : "Sin ganancias";
    cashPill.className = `soft-pill${hayFondos ? " is-ok" : ""}`;

    const retirar = $("#btn-retirar");
    retirar.disabled = !autorizado || estado.ocupado || !hayFondos;
    retirar.textContent = estado.ocupado ? "Procesando…" : "Retirar ganancias";
  }

  async function reponer(id) {
    const producto = estado.productos.find((item) => item.id === id);
    if (!producto || estado.ocupado) return;
    if (!esDueno()) {
      mensajeDueno("Solo la cuenta dueña puede reponer stock.", "bad");
      return;
    }

    if (estado.modo === "demo") {
      producto.stock += 5;
      mensajeDueno(`Repusiste 5 unidades de ${producto.nombre}. Ahora hay ${producto.stock}.`, "ok");
      toast("Stock actualizado");
      anunciar(`Stock de ${producto.nombre}: ${producto.stock} unidades.`);
      render();
      return;
    }

    estado.ocupado = true;
    mensajeDueno("Confirma la reposición en MetaMask…", "warn");
    render();

    try {
      const tx = await estado.contrato.reponer(id, 5);
      await tx.wait();
      await cargarProductos();
      estado.saldoWei = await estado.provider.getBalance(estado.cuenta);
      mensajeDueno(`Reposición confirmada para ${producto.nombre}.`, "ok");
      toast("Stock actualizado en la red");
      anunciar(`Stock de ${producto.nombre} actualizado en la red.`);
    } catch (error) {
      manejarErrorDueno(error);
    } finally {
      estado.ocupado = false;
      render();
    }
  }

  async function retirar() {
    if (estado.ocupado) return;
    if (!esDueno()) {
      mensajeDueno("Solo la cuenta dueña puede retirar las ganancias.", "bad");
      return;
    }
    if (estado.custodiaWei === 0n) {
      mensajeDueno("No hay ganancias para retirar.", "warn");
      return;
    }

    if (estado.modo === "demo") {
      const monto = estado.custodiaWei;
      estado.custodiaWei = 0n;
      mensajeDueno(`Retiro simulado: ${formatEth(monto)} enviados a la cuenta dueña.`, "ok");
      toast(`Ganancias retiradas: ${formatEth(monto)}`);
      anunciar(`Retiro simulado de ${formatEth(monto)}.`);
      render();
      return;
    }

    estado.ocupado = true;
    mensajeDueno("Confirma el retiro en MetaMask…", "warn");
    render();

    try {
      const tx = await estado.contrato.retirar();
      await tx.wait();
      await cargarProductos();
      estado.saldoWei = await estado.provider.getBalance(estado.cuenta);
      mensajeDueno("Ganancias retiradas y enviadas a tu cuenta.", "ok");
      toast("Ganancias retiradas en la red");
      anunciar("Ganancias retiradas y enviadas a la cuenta dueña.");
    } catch (error) {
      manejarErrorDueno(error);
    } finally {
      estado.ocupado = false;
      render();
    }
  }

  function manejarErrorDueno(error) {
    const cancelada =
      error?.code === "ACTION_REJECTED" ||
      error?.code === 4001 ||
      /rejected|denied|cancel/i.test(`${error?.message || ""} ${error?.shortMessage || ""}`);
    const codigo = cancelada ? "FirmaCancelada" : nombreError(error) || "ErrorDeRed";
    const detalle = ERRORES[codigo] || limpiarError(error);
    mensajeDueno(`${codigo}: ${detalle}`, cancelada ? "warn" : "bad");
    toast(detalle);
  }

  function actualizarPreview() {
    const producto = productoActual();
    const elemento = $("#pago-preview");
    elemento.className = "pay-preview";
    if (!producto) return;

    const pago = parseEth($("#monto").value);
    if (pago === null || pago <= 0n) {
      elemento.textContent = "Escribe un monto como 0,002.";
      elemento.classList.add("is-bad");
      return;
    }
    if (pago < producto.precioWei) {
      elemento.textContent = `Faltan ${formatEth(producto.precioWei - pago)}: la compra se cancelará.`;
      elemento.classList.add("is-bad");
      return;
    }

    const cambio = pago - producto.precioWei;
    elemento.textContent = cambio > 0n ? `Cambio: ${formatEth(cambio)}.` : "Pago exacto.";
    elemento.classList.add("is-ok");

    if (estado.modo !== "real" && pago > estado.saldoWei) {
      elemento.textContent = `Tu saldo demo no cubre ${formatEth(pago)}.`;
      elemento.classList.add("is-bad");
    }
  }

  /* Compra */
  async function comprar() {
    if (estado.ocupado) return;
    const producto = productoActual();
    if (!producto) return;

    const pago = parseEth($("#monto").value);
    if (pago === null || pago <= 0n) {
      fallo("MontoInvalido", ERRORES.MontoInvalido);
      return;
    }
    if (producto.stock === 0) {
      fallo("SinStock", ERRORES.SinStock);
      return;
    }
    if (pago < producto.precioWei) {
      fallo(
        "PagoInsuficiente",
        `Pagaste ${formatEth(pago)} y el precio es ${formatEth(producto.precioWei)}.`
      );
      return;
    }

    if (estado.modo === "real") {
      if (!estado.contrato) {
        toast("Conecta la billetera primero.");
        return;
      }
      await comprarReal(producto, pago);
      return;
    }

    if (pago > estado.saldoWei) {
      fallo(
        "SaldoInsuficiente",
        `Tu saldo demo es ${formatEth(estado.saldoWei)} y el pago es ${formatEth(pago)}.`
      );
      return;
    }

    comprarDemo(producto, pago);
  }

  function comprarDemo(producto, pago) {
    const cambio = pago - producto.precioWei;
    estado.saldoWei = estado.saldoWei - pago + cambio;
    estado.custodiaWei += producto.precioWei;
    producto.stock -= 1;
    estado.ventas += 1;

    estado.recibo = {
      ok: true,
      producto: producto.nombre,
      emoji: producto.emoji,
      precio: producto.precioWei,
      pagado: pago,
      cambio,
      stock: producto.stock,
      venta: estado.ventas,
    };

    mensaje(`Compra confirmada. Tu cambio de ${formatEth(cambio)} volvió al saldo.`, "ok");
    pantalla("ENTREGADO", `Cambio: ${formatEth(cambio)}`, "ok");
    entregar(producto.emoji, `${producto.nombre} en la bandeja`);
    toast("Compra confirmada · cambio devuelto");
    anunciar(`Compra confirmada de ${producto.nombre}. Cambio: ${formatEth(cambio)}.`);
    render();
  }

  async function comprarReal(producto, pago) {
    estado.ocupado = true;
    render();
    mensaje("Confirma la transacción en MetaMask…", "warn");
    pantalla("FIRMANDO", "Confirma en MetaMask");

    try {
      const contrato = estado.contrato;
      const tx = await contrato.comprar(producto.id, { value: pago });
      pantalla("PENDIENTE", `Tx ${corto(tx.hash)}`);
      const recibo = await tx.wait();

      let evento = null;
      for (const log of recibo.logs) {
        try {
          const analizado = contrato.interface.parseLog(log);
          if (analizado?.name === "Compra") evento = analizado;
        } catch {
          /* Log de otro contrato. */
        }
      }
      if (!evento) throw new Error("La transacción se confirmó sin el evento Compra.");

      const precio = BigInt(evento.args.precio);
      const cambio = BigInt(evento.args.cambio);
      estado.recibo = {
        ok: true,
        producto: String(evento.args.nombre),
        emoji: producto.emoji,
        precio,
        pagado: precio + cambio,
        cambio,
        stock: Number(evento.args.stockRestante),
        venta: Number(evento.args.numeroVenta),
      };

      mensaje("Compra confirmada en la red local.", "ok");
      pantalla("ENTREGADO", `Cambio: ${formatEth(cambio)}`, "ok");
      entregar(producto.emoji, `${evento.args.nombre} en la bandeja`);
      toast("Compra firmada y confirmada");
      anunciar(`Compra confirmada de ${evento.args.nombre}.`);

      await cargarProductos();
      estado.saldoWei = await estado.provider.getBalance(estado.cuenta);
    } catch (error) {
      manejarError(error, producto);
    } finally {
      estado.ocupado = false;
      render();
    }
  }

  function fallo(codigo, detalle) {
    estado.recibo = { ok: false, codigo, detalle };
    mensaje(`${codigo}: ${detalle}`, "bad");
    pantalla("CANCELADO", codigo, "bad");
    toast("Compra cancelada");
    anunciar(`Compra cancelada. ${detalle}`);
    render();
  }

  function nombreError(error) {
    if (error?.revert?.name) return error.revert.name;
    const texto = [error?.shortMessage, error?.message, error?.info?.error?.message, error?.data?.message]
      .filter(Boolean)
      .join(" ");
    return Object.keys(ERRORES).find((nombre) => texto.includes(nombre)) || null;
  }

  function limpiarError(error) {
    return (error?.shortMessage || error?.message || "Error de la billetera.")
      .split("\n")[0]
      .slice(0, 200);
  }

  function manejarError(error, producto) {
    const cancelada =
      error?.code === "ACTION_REJECTED" ||
      error?.code === 4001 ||
      /rejected|denied|cancel/i.test(`${error?.message || ""} ${error?.shortMessage || ""}`);

    if (cancelada) {
      estado.recibo = { ok: false, codigo: "FirmaCancelada", detalle: ERRORES.FirmaCancelada };
      mensaje(ERRORES.FirmaCancelada, "warn");
      pantalla("CANCELADO", "Sin transacción");
      anunciar(ERRORES.FirmaCancelada);
    } else {
      const codigo = nombreError(error) || "ErrorDeRed";
      const detalle = ERRORES[codigo] || limpiarError(error);
      estado.recibo = { ok: false, codigo, detalle };
      mensaje(`${codigo}: ${detalle}`, "bad");
      pantalla("CANCELADO", codigo, "bad");
      anunciar(`Error. ${detalle}`);
    }
    if (producto) estado.recibo.producto = producto.nombre;
    render();
  }

  /* Conexión */
  async function cambiarRed(chainId) {
    const hex = `0x${Number(chainId).toString(16)}`;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hex }],
      });
    } catch (error) {
      const noExiste =
        error?.code === 4902 || /Unrecognized chain|not added|Try adding/i.test(error?.message || "");
      if (!noExiste) throw error;
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: hex,
            chainName: "Hardhat local",
            rpcUrls: [CONFIG?.rpcUrl || "http://127.0.0.1:8545"],
            nativeCurrency: { name: "Ether de prueba", symbol: "ETH", decimals: 18 },
          },
        ],
      });
    }
  }

  function escucharWallet() {
    if (!window.ethereum?.on || estado.listeners) return;
    estado.listeners = true;
    window.ethereum.on("accountsChanged", () => {
      if (estado.modo === "real") window.location.reload();
    });
    window.ethereum.on("chainChanged", () => {
      if (estado.modo === "real") window.location.reload();
    });
  }

  async function conectar() {
    if (estado.modo === "real") {
      volverADemo();
      return;
    }
    if (!CONFIG?.address) {
      toast("Despliega el contrato para usar una billetera real.");
      return;
    }
    if (!window.ethereum) {
      toast("Instala MetaMask para conectar una billetera.");
      window.open("https://metamask.io/download/", "_blank", "noreferrer");
      return;
    }
    if (!window.ethers) {
      toast("No se pudo cargar ethers.js. Revisa tu conexión y recarga.");
      return;
    }

    estado.ocupado = true;
    render();

    try {
      let provider = new window.ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);

      let red = await provider.getNetwork();
      if (Number(red.chainId) !== Number(CONFIG.chainId)) {
        await cambiarRed(CONFIG.chainId);
        provider = new window.ethers.BrowserProvider(window.ethereum);
        red = await provider.getNetwork();
        if (Number(red.chainId) !== Number(CONFIG.chainId)) {
          throw new Error(`Conecta MetaMask a la red ${CONFIG.chainId}.`);
        }
      }

      const signer = await provider.getSigner();
      const cuenta = await signer.getAddress();
      const codigo = await provider.getCode(CONFIG.address);
      if (!codigo || codigo === "0x") {
        throw new Error("No hay contrato en esa dirección. Ejecuta npm run deploy:local.");
      }

      estado.provider = provider;
      estado.contrato = new window.ethers.Contract(CONFIG.address, CONFIG.abi, signer);
      estado.cuenta = cuenta;
      estado.modo = "real";

      await cargarProductos();
      estado.saldoWei = await provider.getBalance(cuenta);
      escucharWallet();

      mensaje("Billetera conectada. Ya puedes firmar compras.", "ok");
      mensajeDueno(
        esDueno()
          ? "Cuenta dueña conectada. Ya puedes reponer stock y retirar ganancias."
          : "Cuenta conectada sin permisos de dueño. Puedes comprar, pero no administrar.",
        esDueno() ? "ok" : "warn"
      );
      pantalla("CONECTADO", "Billetera lista", "ok");
      toast("MetaMask conectado a Hardhat local");
      anunciar("Billetera conectada.");
    } catch (error) {
      estado.modo = "demo";
      estado.provider = null;
      estado.contrato = null;
      estado.cuenta = null;
      estado.dueno = null;
      estado.productos = productosBase();
      estado.custodiaWei = 0n;
      estado.ventas = 0;
      estado.saldoWei = parseEth("0.15");
      mensajeDueno("Conecta una billetera para administrar la máquina.", "");

      const cancelada =
        error?.code === "ACTION_REJECTED" ||
        error?.code === 4001 ||
        /rejected|denied|cancel/i.test(`${error?.message || ""} ${error?.shortMessage || ""}`);
      const detalle = cancelada ? ERRORES.FirmaCancelada : limpiarError(error);
      mensaje(`No se pudo conectar: ${detalle}`, "warn");
      pantalla("MODO DEMO", "Sigue disponible la simulación");
      toast(detalle);
    } finally {
      estado.ocupado = false;
      render();
    }
  }

  async function cargarProductos() {
    const crudos = await estado.contrato.obtenerProductos();
    estado.productos = crudos.map((producto, id) => ({
      id,
      nombre: String(producto.nombre),
      precioWei: BigInt(producto.precio),
      stock: Number(producto.stock),
      emoji: CATALOGO[id]?.emoji || "🍽️",
    }));
    if (!estado.productos.some((producto) => producto.id === estado.seleccionado)) {
      estado.seleccionado = 0;
    }
    estado.ventas = Number(await estado.contrato.ventas());
    estado.custodiaWei = await estado.provider.getBalance(CONFIG.address);
    estado.dueno = await estado.contrato.dueno();
    const actual = productoActual();
    if (actual) $("#monto").value = ethInput(actual.precioWei);
  }

  function volverADemo() {
    estado.modo = "demo";
    estado.provider = null;
    estado.contrato = null;
    estado.cuenta = null;
    estado.dueno = null;
    estado.productos = productosBase();
    estado.seleccionado = 0;
    estado.saldoWei = parseEth("0.15");
    estado.custodiaWei = 0n;
    estado.ventas = 0;
    estado.recibo = null;
    estado.ocupado = false;
    $("#monto").value = ethInput(estado.productos[0].precioWei);
    reiniciarBandeja();
    mensaje("Volviste al modo demo. No se firma nada.", "");
    mensajeDueno("Modo dueño demo activo. Puedes reponer stock y retirar ganancias simuladas.", "");
    pantalla("LISTO", "Elige tu antojo");
    render();
    toast("Modo demo activo");
  }

  function reiniciar() {
    estado.productos = productosBase();
    estado.seleccionado = 0;
    estado.saldoWei = parseEth("0.15");
    estado.custodiaWei = 0n;
    estado.ventas = 0;
    estado.recibo = null;
    estado.ocupado = false;
    $("#monto").value = ethInput(estado.productos[0].precioWei);
    reiniciarBandeja();
    mensaje("Demo reiniciada: 6 productos y 0,15 ETH de prueba.", "ok");
    mensajeDueno("Stock y ganancias reiniciados.", "ok");
    pantalla("LISTO", "Elige tu antojo");
    render();
    toast("Demo reiniciada");
  }

  function recargarSaldo() {
    if (estado.modo === "real") return;
    estado.saldoWei += parseEth("0.05");
    mensaje("Agregaste 0,05 ETH de prueba a tu saldo.", "ok");
    toast("Saldo demo recargado");
    render();
  }

  /* Eventos e inicio */
  function enlazar() {
    $("#btn-comprar").addEventListener("click", comprar);
    $("#btn-saldo").addEventListener("click", recargarSaldo);
    $("#btn-reiniciar").addEventListener("click", reiniciar);
    $("#btn-conectar").addEventListener("click", conectar);
    $("#btn-retirar").addEventListener("click", retirar);
    $("#owner-productos").addEventListener("click", (evento) => {
      const boton = evento.target.closest("button[data-id]");
      if (!boton) return;
      reponer(Number(boton.dataset.id));
    });

    $("#monto").addEventListener("input", actualizarPreview);
    $("#monto").addEventListener("keydown", (evento) => {
      if (evento.key === "Enter") {
        evento.preventDefault();
        comprar();
      }
    });

    $$(".amounts button").forEach((boton) => {
      boton.addEventListener("click", () => {
        const producto = productoActual();
        if (!producto) return;
        const valor = boton.dataset.monto;
        const extra = boton.dataset.extra;
        const monto = extra ? producto.precioWei + parseEth(extra) : parseEth(valor);
        if (monto === null) return;
        $("#monto").value = ethInput(monto);
        actualizarPreview();
      });
    });
  }

  function init() {
    estado.productos = productosBase();
    estado.seleccionado = 0;
    estado.saldoWei = parseEth("0.15");
    $("#monto").value = ethInput(estado.productos[0].precioWei);

    enlazar();
    render();
    pantalla("LISTO", "Elige tu antojo");
    mensaje("Elige un producto. El pago exacto ya está listo.", "");
  }

  init();
})();
