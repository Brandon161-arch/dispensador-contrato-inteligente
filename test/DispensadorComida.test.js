const { expect } = require("chai");
const { ethers } = require("hardhat");

const EMPANADA = ethers.parseEther("0.002");
const AREPA = ethers.parseEther("0.003");
const LIMONADA = ethers.parseEther("0.0025");

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

  it("arranca con seis productos y el despliegue como dueño", async function () {
    expect(await dispensador.dueno()).to.equal(dueno.address);
    expect(await dispensador.ventas()).to.equal(0n);

    const productos = await dispensador.obtenerProductos();
    expect(productos).to.have.lengthOf(6);
    expect(productos[0].nombre).to.equal("Empanada");
    expect(productos[0].precio).to.equal(EMPANADA);
    expect(productos[0].stock).to.equal(10n);
    expect(productos[5].nombre).to.equal("Limonada");
  });

  it("vende con pago exacto, descuenta stock y emite Compra", async function () {
    await expect(dispensador.connect(comprador).comprar(0, { value: EMPANADA }))
      .to.emit(dispensador, "Compra")
      .withArgs(comprador.address, 0n, "Empanada", EMPANADA, 0n, 9n, 1n);

    expect((await dispensador.obtenerProductos())[0].stock).to.equal(9n);
    expect(await dispensador.ventas()).to.equal(1n);
  });

  it("devuelve el cambio y solo cobra el precio", async function () {
    const pago = ethers.parseEther("0.003");

    await expect(dispensador.connect(comprador).comprar(0, { value: pago }))
      .to.emit(dispensador, "Compra")
      .withArgs(
        comprador.address,
        0n,
        "Empanada",
        EMPANADA,
        ethers.parseEther("0.001"),
        9n,
        1n
      );

    await expect(
      dispensador.connect(comprador).comprar(1, { value: pago })
    ).to.changeEtherBalances([comprador, dispensador], [-AREPA, AREPA]);
  });

  it("revierte si el pago no alcanza y no toca el stock", async function () {
    await expect(
      dispensador.connect(comprador).comprar(0, { value: ethers.parseEther("0.001") })
    )
      .to.be.revertedWithCustomError(dispensador, "PagoInsuficiente")
      .withArgs(ethers.parseEther("0.001"), EMPANADA);

    expect((await dispensador.obtenerProductos())[0].stock).to.equal(10n);
    expect(await dispensador.ventas()).to.equal(0n);
  });

  it("revierte cuando el producto está agotado", async function () {
    for (let i = 0; i < 7; i++) {
      await dispensador.connect(comprador).comprar(5, { value: LIMONADA });
    }

    await expect(
      dispensador.connect(comprador).comprar(5, { value: LIMONADA })
    )
      .to.be.revertedWithCustomError(dispensador, "SinStock")
      .withArgs(5n);
  });

  it("rechaza transferencias directas sin llamar comprar()", async function () {
    await expect(
      comprador.sendTransaction({ to: await dispensador.getAddress(), value: 1n })
    ).to.be.revertedWithCustomError(dispensador, "NoAceptaPagosDirectos");
  });

  it("revierte si el producto no existe", async function () {
    await expect(
      dispensador.connect(comprador).comprar(99, { value: EMPANADA })
    )
      .to.be.revertedWithCustomError(dispensador, "ProductoInexistente")
      .withArgs(99n);
  });

  it("solo el dueño puede reponer y retirar", async function () {
    await expect(dispensador.connect(otro).reponer(0, 5))
      .to.be.revertedWithCustomError(dispensador, "SoloDueno")
      .withArgs(otro.address);

    await expect(dispensador.connect(otro).retirar())
      .to.be.revertedWithCustomError(dispensador, "SoloDueno")
      .withArgs(otro.address);
  });

  it("permite reponer stock al dueño", async function () {
    await expect(dispensador.reponer(0, 5))
      .to.emit(dispensador, "Reposicion")
      .withArgs(0n, 5n, 15n);

    expect((await dispensador.obtenerProductos())[0].stock).to.equal(15n);

    await expect(dispensador.reponer(0, 0))
      .to.be.revertedWithCustomError(dispensador, "CantidadInvalida");
  });

  it("retira todas las ganancias y deja el contrato en cero", async function () {
    await dispensador.connect(comprador).comprar(0, { value: EMPANADA });
    await dispensador.connect(comprador).comprar(1, { value: AREPA });

    const saldo = await ethers.provider.getBalance(await dispensador.getAddress());
    expect(saldo).to.equal(EMPANADA + AREPA);

    await expect(dispensador.retirar())
      .to.emit(dispensador, "Retiro")
      .withArgs(dueno.address, saldo);

    expect(await ethers.provider.getBalance(await dispensador.getAddress())).to.equal(0n);

    await expect(dispensador.retirar())
      .to.be.revertedWithCustomError(dispensador, "SinGanancias");
  });
});
