/**
 * ABI passed to simulateContract / writeContract.
 * Error items are the custom errors from the forge artifacts
 * out/GasRescueSwap.sol/GasRescueSwap.json and
 * out/LockedDemoSwapRouter.sol/LockedDemoSwapRouter.json,
 * plus ERC2612InvalidSigner from out/ERC20Permit.sol/ERC20Permit.json.
 */
export const rescueAbi = [
  {
    "type": "function",
    "name": "rescueWithPermit",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "order",
        "type": "tuple",
        "components": [
          {
            "name": "user",
            "type": "address"
          },
          {
            "name": "tokenIn",
            "type": "address"
          },
          {
            "name": "amountIn",
            "type": "uint256"
          },
          {
            "name": "feeAmount",
            "type": "uint256"
          },
          {
            "name": "feeTo",
            "type": "address"
          },
          {
            "name": "amountSwap",
            "type": "uint256"
          },
          {
            "name": "minAmountOut",
            "type": "uint256"
          },
          {
            "name": "to",
            "type": "address"
          },
          {
            "name": "nativeTo",
            "type": "address"
          },
          {
            "name": "router",
            "type": "address"
          },
          {
            "name": "pathHash",
            "type": "bytes32"
          },
          {
            "name": "chainId",
            "type": "uint256"
          },
          {
            "name": "deadline",
            "type": "uint256"
          },
          {
            "name": "nonce",
            "type": "uint256"
          }
        ]
      },
      {
        "name": "orderSignature",
        "type": "bytes"
      },
      {
        "name": "v",
        "type": "uint8"
      },
      {
        "name": "r",
        "type": "bytes32"
      },
      {
        "name": "s",
        "type": "bytes32"
      },
      {
        "name": "swapData",
        "type": "bytes"
      }
    ],
    "outputs": []
  },
  {
    "type": "error",
    "name": "AddressEmptyCode",
    "inputs": [
      {
        "name": "target",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "AddressInsufficientBalance",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "DustRemaining",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ECDSAInvalidSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ECDSAInvalidSignatureLength",
    "inputs": [
      {
        "name": "length",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ECDSAInvalidSignatureS",
    "inputs": [
      {
        "name": "s",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "EnforcedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ExpectedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ExpiredDeadline",
    "inputs": []
  },
  {
    "type": "error",
    "name": "FailedInnerCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "FoTOrBalanceMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidOrder",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidPermit2",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidShortString",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NativeTransferFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoGaslessAuth",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotRelayer",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OwnableInvalidOwner",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "OwnableUnauthorizedAccount",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "OwnerIsRelayer",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OwnershipCannotBeRenounced",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PathMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Permit2Immutable",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RouterNotAllowed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "Slippage",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StringTooLong",
    "inputs": [
      {
        "name": "str",
        "type": "string",
        "internalType": "string"
      }
    ]
  },
  {
    "type": "error",
    "name": "SwapFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SwapInputNotConsumed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TokenNotAllowed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Underfunded",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UsedNonce",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WrongChain",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EthTransferFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InsufficientEth",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidRate",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotEnoughTokens",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotRescue",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroPayout",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ERC2612InvalidSigner",
    "inputs": [
      {
        "name": "signer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ]
  }
];
