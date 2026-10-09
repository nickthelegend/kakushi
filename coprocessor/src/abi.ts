import { parseAbi } from "viem";

export const executorEvents = parseAbi([
  "event FheOp(uint8 indexed op, bytes32 result, bytes32 lhs, bytes32 rhs, bool scalar, address indexed caller)",
  "event FheSelect(bytes32 result, bytes32 control, bytes32 ifTrue, bytes32 ifFalse, address indexed caller)",
  "event TrivialEncrypt(bytes32 result, uint256 value, uint8 toType)",
  "event VerifyInput(bytes32 result, bytes32 inputHandle, address indexed user, address indexed caller)",
  "event Rand(bytes32 result, uint256 upperBound, bytes32 seed, uint8 randType)",
]);

export const oracleAbi = parseAbi([
  "event DecryptionRequested(uint256 indexed requestId, address indexed requester, bytes32[] handles, bytes4 callback)",
  "event DecryptionFulfilled(uint256 indexed requestId, uint256[] cleartexts, bool callbackOk, address via)",
  "function requests(uint256) view returns (address requester, bytes4 callback, bool fulfilled, bytes32 handlesHash)",
  "function handlesOf(uint256) view returns (bytes32[])",
  "function fulfill(uint256 requestId, uint256[] cleartexts, bytes[] signatures)",
  "function domainSeparator() view returns (bytes32)",
]);

export const aclAbi = parseAbi([
  "function isAllowed(bytes32 handle, address account) view returns (bool)",
  "function isAllowedForDecryption(bytes32 handle) view returns (bool)",
]);
