const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

async function main() {
  const [dueno] = await hre.ethers.getSigners();
  const red = await hre.ethers.provider.getNetwork();

  console.log(`Desplegando DispensadorComida en la red ${hre.network.name} (chainId ${red.chainId})...`);

  const Fabrica = await hre.ethers.getContractFactory("DispensadorComida");
  const contrato = await Fabrica.deploy();
  await contrato.waitForDeployment();

  const direccion = await contrato.getAddress();
  const recibo = await contrato.deploymentTransaction().wait();

  console.log(`Contrato desplegado en: ${direccion}`);
  console.log(`Dueño: ${dueno.address}`);
  console.log(`Bloque: ${recibo.blockNumber}`);

  if (hre.network.name !== "localhost") {
    console.warn(
      "\nAviso: esta red es efímera. Para que la web pueda conectarse, inicia " +
        "`npm run node` y ejecuta `npm run deploy:local` en otra terminal."
    );
    return;
  }

  const artifact = await hre.artifacts.readArtifact("DispensadorComida");
  const config = {
    address: direccion,
    chainId: Number(red.chainId),
    dueno: dueno.address,
    red: "Hardhat local",
    rpcUrl: "http://127.0.0.1:8545",
    abi: artifact.abi,
    desplegadoEn: new Date().toISOString(),
  };

  const destino = path.join(__dirname, "..", "web", "contract-config.js");
  const contenido =
    "// Archivo generado por scripts/deploy.js. No lo edites a mano.\n" +
    `window.CONTRATO_DISPENSADOR = ${JSON.stringify(config, null, 2)};\n`;

  fs.writeFileSync(destino, contenido, "utf8");
  console.log(`\nConfiguración web escrita en: web/contract-config.js`);
  console.log("Abre la máquina con `npm run web` y conecta MetaMask a Hardhat local.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
