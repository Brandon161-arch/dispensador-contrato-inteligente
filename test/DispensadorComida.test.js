const { expect } = require("chai");
const { ethers } = require("hardhat");

const GRANOLA = ethers.parseEther("0.002");
const MANZANA = ethers.parseEther("0.001");
const ENSALADA = ethers.parseEther("0.005");

describe("DispensadorComida", function () {
  let dispensador;
  let dueno;
  let comprador;
  let otro;

  beforeEach(async function () {
    [dueno, comprador, otro] = await ethers.getSigners();
    const Fabrica = await ethers.getContractFactory("DispensadorComida");
    dispensador = await Fabrica.deploy();
    await dispensador.waitForDeployment();
  });

  describe("Despliegue y catálogo", function () {
    it("asigna al despliegue como dueño y arranca activa", async function () {
      expect(await dispensador.dueno()).to.equal(dueno.address);
      expect(await dispensador.pausado()).to.equal(false);
      expect(await dispensador.totalVentas()).to.equal(0n);
    });

    it("publica nueve productos con precio y stock", async function () {
      const productos = await dispensador.obtenerProductos();
      expect(productos).to.have.lengthOf(9);
      expect(productos[0].nombre).to.equal("Barra de granola");
      expect(productos[0].precio).to.equal(GRANOLA);
      expect(productos[0].stock).to.equal(12n);
      expect(productos[1].nombre).to.equal("Manzana");
      expect(productos[8].nombre).to.equal("Ensalada");
    });

    it("entrega el resumen completo en una sola lectura", async function () {
      const resumen = await dispensador.resumen();
      expect(resumen.ventas).to.equal(0n);
      expect(resumen.recaudado).to.equal(0n);
      expect(resumen.saldoEnCustodia).to.equal(0n);
      expect(resumen.productosRegistrados).to.equal(9n);
      expect(resumen.maquinaPausada).to.equal(false);
    });
  });

  describe("Compras", function () {
    it("vende con pago exacto, descuenta stock y emite el evento", async function () {
      await expect(dispensador.connect(comprador).comprar(0, { value: GRANOLA }))
        .to.emit(dispensador, "CompraExitosa")
        .withArgs(comprador.address, 0n, "Barra de granola", GRANOLA, 0n, 11n, 1n);

      const producto = (await dispensador.obtenerProductos())[0];
      expect(producto.stock).to.equal(11n);
      expect(await dispensador.totalVentas()).to.equal(1n);
      expect(await dispensador.totalRecaudado()).to.equal(GRANOLA);
      expect(await ethers.provider.getBalance(await dispensador.getAddress())).to.equal(GRANOLA);
    });

    it("devuelve el cambio y solo descuenta el precio", async function () {
      const pago = ethers.parseEther("0.003");

      await expect(dispensador.connect(comprador).comprar(0, { value: pago }))
        .to.emit(dispensador, "CompraExitosa")
        .withArgs(comprador.address, 0n, "Barra de granola", GRANOLA, ethers.parseEther("0.001"), 11n, 1n);

      await expect(
        dispensador.connect(comprador).comprar(0, { value: pago })
      ).to.changeEtherBalances([comprador, dispensador], [-GRANOLA, GRANOLA]);
    });

    it("revierte con PagoInsuficiente y no altera el stock", async function () {
      await expect(
        dispensador.connect(comprador).comprar(0, { value: ethers.parseEther("0.001") })
      )
        .to.be.revertedWithCustomError(dispensador, "PagoInsuficiente")
        .withArgs(ethers.parseEther("0.001"), GRANOLA);

      const producto = (await dispensador.obtenerProductos())[0];
      expect(producto.stock).to.equal(12n);
      expect(await dispensador.totalVentas()).to.equal(0n);
    });

    it("revierte cuando el producto no tiene stock", async function () {
      for (let i = 0; i < 6; i++) {
        await dispensador.connect(comprador).comprar(8, { value: ENSALADA });
      }

      await expect(
        dispensador.connect(comprador).comprar(8, { value: ENSALADA })
      )
        .to.be.revertedWithCustomError(dispensador, "SinStock")
        .withArgs(8n);
    });

    it("revierte si el producto está inactivo", async function () {
      await dispensador.configurarProducto(0, GRANOLA, false);

      await expect(
        dispensador.connect(comprador).comprar(0, { value: GRANOLA })
      )
        .to.be.revertedWithCustomError(dispensador, "ProductoInactivo")
        .withArgs(0n);
    });

    it("revierte si la máquina está pausada", async function () {
      await dispensador.pausar(true);

      await expect(
        dispensador.connect(comprador).comprar(0, { value: GRANOLA })
      ).to.be.revertedWithCustomError(dispensador, "MaquinaPausada");
    });

    it("revierte si el identificador no existe", async function () {
      await expect(
        dispensador.connect(comprador).comprar(99, { value: GRANOLA })
      )
        .to.be.revertedWithCustomError(dispensador, "ProductoInexistente")
        .withArgs(99n);
    });

    it("rechaza transferencias directas sin llamar comprar()", async function () {
      await expect(
        comprador.sendTransaction({ to: await dispensador.getAddress(), value: 1n })
      ).to.be.revertedWithCustomError(dispensador, "NoAceptaPagosDirectos");
    });
  });

  describe("Administración del dueño", function () {
    it("permite reponer stock y emite ProductoRepuesto", async function () {
      await expect(dispensador.reponer(0, 5))
        .to.emit(dispensador, "ProductoRepuesto")
        .withArgs(0n, 5n, 17n);

      const producto = (await dispensador.obtenerProductos())[0];
      expect(producto.stock).to.equal(17n);
    });

    it("solo el dueño puede reponer, configurar, pausar o retirar", async function () {
      await expect(dispensador.connect(otro).reponer(0, 5))
        .to.be.revertedWithCustomError(dispensador, "SoloDueno")
        .withArgs(otro.address);

      await expect(dispensador.connect(otro).configurarProducto(0, GRANOLA, false))
        .to.be.revertedWithCustomError(dispensador, "SoloDueno")
        .withArgs(otro.address);

      await expect(dispensador.connect(otro).pausar(true))
        .to.be.revertedWithCustomError(dispensador, "SoloDueno")
        .withArgs(otro.address);

      await expect(dispensador.connect(otro).retirarGanancias())
        .to.be.revertedWithCustomError(dispensador, "SoloDueno")
        .withArgs(otro.address);
    });

    it("cambia el precio y cobra el nuevo valor", async function () {
      const nuevoPrecio = ethers.parseEther("0.0025");
      await expect(dispensador.configurarProducto(0, nuevoPrecio, true))
        .to.emit(dispensador, "ProductoConfigurado")
        .withArgs(0n, nuevoPrecio, true);

      await expect(
        dispensador.connect(comprador).comprar(0, { value: GRANOLA })
      )
        .to.be.revertedWithCustomError(dispensador, "PagoInsuficiente")
        .withArgs(GRANOLA, nuevoPrecio);

      await expect(
        dispensador.connect(comprador).comprar(0, { value: nuevoPrecio })
      ).to.emit(dispensador, "CompraExitosa");
    });

    it("agrega un producto nuevo al catálogo", async function () {
      await expect(dispensador.agregarProducto("Empanada", ethers.parseEther("0.0035"), 10))
        .to.emit(dispensador, "ProductoAgregado")
        .withArgs(9n, "Empanada", ethers.parseEther("0.0035"), 10n);

      const productos = await dispensador.obtenerProductos();
      expect(productos).to.have.lengthOf(10);
      expect(productos[9].nombre).to.equal("Empanada");
      expect(productos[9].stock).to.equal(10n);
    });

    it("rechaza parámetros inválidos de administración", async function () {
      await expect(dispensador.reponer(0, 0))
        .to.be.revertedWithCustomError(dispensador, "CantidadInvalida");
      await expect(dispensador.configurarProducto(0, 0, true))
        .to.be.revertedWithCustomError(dispensador, "PrecioInvalido");
      await expect(dispensador.agregarProducto("", GRANOLA, 2))
        .to.be.revertedWithCustomError(dispensador, "NombreVacio");
      await expect(dispensador.pausar(false))
        .to.be.revertedWithCustomError(dispensador, "EstadoSinCambios");
    });

    it("retira todas las ganancias y deja el contrato en cero", async function () {
      await dispensador.connect(comprador).comprar(0, { value: GRANOLA });
      await dispensador.connect(comprador).comprar(1, { value: MANZANA });

      const saldo = await ethers.provider.getBalance(await dispensador.getAddress());
      expect(saldo).to.equal(GRANOLA + MANZANA);

      await expect(dispensador.retirarGanancias())
        .to.emit(dispensador, "GananciasRetiradas")
        .withArgs(dueno.address, saldo);

      expect(await ethers.provider.getBalance(await dispensador.getAddress())).to.equal(0n);

      await expect(dispensador.retirarGanancias())
        .to.be.revertedWithCustomError(dispensador, "SinGanancias");
    });

    it("bloquea un intento de reentrada durante la devolución del cambio", async function () {
      const FabricaAtacante = await ethers.getContractFactory("AtacanteReentrante");
      const atacante = await FabricaAtacante.deploy(await dispensador.getAddress());
      await atacante.waitForDeployment();

      await expect(
        atacante.atacar(0, { value: ethers.parseEther("0.003") })
      ).to.emit(dispensador, "CompraExitosa");

      expect(await atacante.reintentado()).to.equal(true);

      const producto = (await dispensador.obtenerProductos())[0];
      expect(producto.stock).to.equal(11n);
      expect(await dispensador.totalVentas()).to.equal(1n);
      expect(await ethers.provider.getBalance(await dispensador.getAddress())).to.equal(GRANOLA);
    });
  });
});
