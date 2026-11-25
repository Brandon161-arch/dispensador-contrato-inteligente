// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DispensadorComida} from "../DispensadorComida.sol";

/// @dev Contrato auxiliar de pruebas. Intenta volver a comprar mientras recibe
///      el cambio para comprobar que el candado noReentrante funciona.
contract AtacanteReentrante {
    DispensadorComida public immutable objetivo;
    uint256 public idProducto;
    bool public reintentado;

    constructor(DispensadorComida _objetivo) {
        objetivo = _objetivo;
    }

    function atacar(uint256 _idProducto) external payable {
        idProducto = _idProducto;
        objetivo.comprar{value: msg.value}(_idProducto);
    }

    receive() external payable {
        if (!reintentado) {
            reintentado = true;
            try objetivo.comprar{value: msg.value}(idProducto) {} catch {}
        }
    }
}
