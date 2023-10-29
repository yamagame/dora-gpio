import * as path from "path"
const { StartServoHead } = require("servo-head")
const { config } = require("~/config")

function main() {
  const { basedir } = config
  const confpath = path.join(basedir, "servo-head.json")

  StartServoHead(confpath, config, (servoHead) => {
    servoHead.mode = process.env.MODE || "idle"
    servoHead.led_mode = process.env.LED_MODE || "off"
    servoHead.led_bright = process.env.LED_VALUE || 1

    const PORT = config.gpioPort
    const app = require("http").createServer(handler)
    const io = require("socket.io")(app)

    function requestHandler(req, callback) {
      let buf = Buffer.from([])
      req.on("data", (data) => {
        buf = Buffer.concat([buf, data])
      })
      req.on("close", () => {})
      req.on("end", () => {
        callback(buf.toString())
      })
    }

    function handler(req, res) {
      if (req.method === "POST") {
        const url = require("url").parse(req.url)
        const params = require("querystring").parse(url.search)
        req.params = params

        // curl -X POST -d '{"h":100,"v":200}' http://localhost:3091/center
        if (url.pathname === "/center" || url.pathname === "/reset") {
          return requestHandler(req, (data) => {
            servoHead.control(data, url.pathname === "/reset")
            res.end("OK\n")
          })
        }

        // curl -X POST http://localhost:3091/stop
        if (url.pathname === "/stop") {
          return requestHandler(req, (data) => {
            servoHead.mode = "stop"
            res.end("OK\n")
          })
        }

        // curl -X POST http://localhost:3091/idle
        if (url.pathname === "/idle") {
          return requestHandler(req, (data) => {
            servoHead.mode = "idle"
            res.end("OK\n")
          })
        }

        // curl -X POST http://localhost:3091/talk
        if (url.pathname === "/talk") {
          return requestHandler(req, (data) => {
            servoHead.mode = "talk"
            res.end("OK\n")
          })
        }

        // curl -X POST http://localhost:3091/save
        if (url.pathname === "/save") {
          return requestHandler(req, (data) => {
            servoHead.saveSetting(path.join(basedir, "servo-head.json"))
            res.end("OK\n")
          })
        }

        // curl -X POST http://localhost:3091/exit
        if (url.pathname === "/exit") {
          return requestHandler(req, (data) => {
            servoHead.mode = "exit"
            servoHead.led_mode = "off"
            setTimeout(() => {
              res.end("OK\n", () => {
                console.log("exit")
                process.exit(0)
              })
            }, 3000)
          })
        }
      }
      res.end()
    }

    app.listen(PORT, () => {
      console.log(`servo-head listening on port ${PORT}!`)
    })

    io.on("connection", function (socket) {
      console.log("connected", socket.id, socket.handshake.address)
      if (config.credentialAccessControl) {
        if (config.localhostIPs.indexOf(socket.handshake.address) === -1) {
          console.log("permission denied")
          return
        }
      }
      console.log("start action")

      socket.on("led-command", (payload, callback) => {
        servoHead.changeLed(payload)
        if (callback) callback()
      })

      socket.on("disconnect", function () {
        console.log("disconnect")
      })

      socket.on("message", function (payload, callback) {
        if (servoHead.mode === "exit") {
          if (callback) callback()
          return
        }
        try {
          const { action, direction } = payload
          if (action === "centering") {
            servoHead.mode = "centering"
          } else if (action === "talk" || action === "idle" || action === "stop") {
            servoHead.mode = action
            if (direction) {
              servoHead.idle(direction)
            }
          } else if (
            action === "led-on" ||
            action === "led-off" ||
            action === "led-blink" ||
            action === "led-talk"
          ) {
            servoHead.led_mode = action.toString().split("-")[1]
            servoHead.led_bright = 1
          }
          if (callback) {
            if (action === "centering") {
              //首が正面を向くまで待つ
              servoHead.centering(() => {
                callback({ action })
              })
            } else {
              callback({ action })
            }
          }
        } catch (err) {
          if (callback) callback()
        }
      })

      socket.on("gamepad", (payload, callback) => {
        if (config.useGamePad) {
          const { action, vendorId, productId } = payload
          if (action === "add") {
            gamepad.add(vendorId, productId)
          }
          if (action === "remove") {
            gamepad.remove(vendorId, productId)
          }
        }
        if (callback) callback()
      })
    })

    setInterval(() => {
      let level = servoHead.buttonRead()
      if (!config.voiceHat) level = 1 - level
      if (servoHead.buttonLevel != level) {
        servoHead.buttonLevel = level
        io.emit("button", { level: level, state: level == 0 })
      }
    }, 100)

    if (config.useGamePad) {
      gamepad.on("event", (event) => {
        io.emit("gamepad", event)
      })
    }
  })
}

if (require.main === module) {
  main()
}