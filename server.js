import express from "express"
import WebSocket, { WebSocketServer } from "ws"
import cors from "cors"
import dotenv from "dotenv"
import { SDK } from "@somnia-chain/streams"
import { createPublicClient, createWalletClient, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { somniaTestnet } from "viem/chains"

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


// Middleware
app.use(cors())
app.use(express.json())

// WebSocket server for real-time data
const wss = new WebSocketServer({ noServer: true })
const clients = new Set()

// Initialize Somnia SDK
let sdk = null
let somniaInitialized = false

const initializeSomnia = async () => {
  try {
    if (!process.env.RPC_URL || !process.env.PRIVATE_KEY) {
      console.log("[INFO] Somnia SDK not configured. Using mock data only.")
      somniaInitialized = false
      return
    }

    const account = privateKeyToAccount(process.env.PRIVATE_KEY)
    sdk = new SDK({
      public: createPublicClient({
        chain: somniaTestnet,
        transport: http(process.env.RPC_URL),
      }),
      wallet: createWalletClient({
        chain: somniaTestnet,
        account,
        transport: http(process.env.RPC_URL),
      }),
    })

    somniaInitialized = true
    console.log("[SUCCESS] Somnia SDK initialized")
  } catch (error) {
    console.error("[ERROR] Failed to initialize Somnia SDK:", error.message)
    somniaInitialized = false
  }
}

// Transaction data storage
let transactions = []
const transactionStats = {
  totalCount: 0,
  perMinute: [],
  lastUpdated: Date.now(),
}

// Generate mock transaction data
const generateMockTransaction = () => {
  const addresses = [
    "0x742d35Cc6634C0532925a3b844Bc9e7595f42bE",
    "0x8ba1f109551bD432803012645Ac136ddd64DBA72",
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "0x70997970C51812e339D9B73b0245adC552C719d1",
    "0x3C44CdDdB6a900c6671B36BeE7e0650407AeC868",
  ]

  const randomAddress = () => addresses[Math.floor(Math.random() * addresses.length)]
  const randomValue = () => (Math.random() * 100).toFixed(4)
  const randomHash = () =>
    "0x" +
    Array(64)
      .fill(0)
      .map(() => Math.floor(Math.random() * 16).toString(16))
      .join("")

  return {
    txHash: randomHash(),
    from: randomAddress(),
    to: randomAddress(),
    value: randomValue(),
    timestamp: Date.now(),
    blockNumber: Math.floor(Math.random() * 1000000),
    gasPrice: (Math.random() * 100).toFixed(2),
  }
}

// Broadcast to all WebSocket clients
const broadcast = (data) => {
  const message = JSON.stringify(data)
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message)
    }
  })
}

// Process new transaction
const addTransaction = (tx) => {
  transactions.unshift(tx)
  if (transactions.length > 100) {
    transactions = transactions.slice(0, 100)
  }

  transactionStats.totalCount++

  // Update per-minute stats
  const now = Math.floor(Date.now() / 60000)
  if (
    transactionStats.perMinute.length === 0 ||
    transactionStats.perMinute[transactionStats.perMinute.length - 1].minute !== now
  ) {
    transactionStats.perMinute.push({ minute: now, count: 1, time: new Date().toLocaleTimeString() })
  } else {
    transactionStats.perMinute[transactionStats.perMinute.length - 1].count++
  }

  if (transactionStats.perMinute.length > 60) {
    transactionStats.perMinute = transactionStats.perMinute.slice(-60)
  }

  // Broadcast update
  broadcast({
    type: "transaction",
    transaction: tx,
    stats: transactionStats,
  })
}

// Simulate mock data stream
const startMockDataStream = () => {
  console.log("[INFO] Starting mock data stream (2-second interval)")
  setInterval(() => {
    const tx = generateMockTransaction()
    addTransaction(tx)
  }, 2000)
}

// HTTP Routes
app.get("/health", (req, res) => {
  res.json({ status: "ok", somnia: somniaInitialized })
})

app.get("/api/transactions", (req, res) => {
  res.json({
    transactions: transactions.slice(0, 20),
    stats: transactionStats,
  })
})

app.get("/api/stats", (req, res) => {
  res.json(transactionStats)
})

// Stream subscription endpoint (for testing Somnia integration)
app.post("/api/stream/subscribe", async (req, res) => {
  if (!somniaInitialized || !sdk) {
    return res.status(503).json({ error: "Somnia SDK not initialized" })
  }

  try {
    const { streamId } = req.body
    res.json({ message: "Subscribed to stream", streamId })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Stream publishing endpoint (for testing Somnia integration)
app.post("/api/stream/publish", async (req, res) => {
  if (!somniaInitialized || !sdk) {
    return res.status(503).json({ error: "Somnia SDK not initialized" })
  }

  try {
    const { data } = req.body
    // This would integrate with actual Somnia SDK
    res.json({ message: "Data published to stream" })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Create HTTP server and upgrade to WebSocket
const server = app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`)
  await initializeSomnia()
  startMockDataStream()
})

server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request)
  })
})

wss.on("connection", (ws) => {
  console.log("[WS] Client connected")
  clients.add(ws)

  // Send initial data
  ws.send(
    JSON.stringify({
      type: "init",
      transactions: transactions.slice(0, 20),
      stats: transactionStats,
    }),
  )

  ws.on("close", () => {
    console.log("[WS] Client disconnected")
    clients.delete(ws)
  })

  ws.on("error", (error) => {
    console.error("[WS] Error:", error.message)
  })
})
