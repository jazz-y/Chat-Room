let allRooms = {
    "rooms": {

    },
    "roomNames": []
};

let socketMap = {};

// Require the packages we will use:
const http = require("http"),
    fs = require("fs");

const port = 3456;
const file = "client.html";

function save() {
    fs.writeFileSync('allRooms.json', JSON.stringify(allRooms, null, 2));
}

// Listen for HTTP connections.  This is essentially a miniature static file server that only serves our one file, client.html, on port 3456:
const server = http.createServer(function (req, res) {
    // This callback runs when a new connection is made to our HTTP server.

    fs.readFile(file, function (err, data) {
        // This callback runs when the client.html file has been read from the filesystem.
        if (err) return res.writeHead(500);
        res.writeHead(200);
        res.end(data);
    });

    fs.readFile('allRooms.json', 'utf8', (err, data) => {
        if (!err) {
            allRooms = JSON.parse(data);
        } else {
            save();
        }
    });

});
server.listen(port);

// Import Socket.IO and pass our HTTP server object to it.
const socketio = require("socket.io")(http, {
    wsEngine: 'ws'
});

// Attach our Socket.IO server to our HTTP server to listen
const io = socketio.listen(server);
io.sockets.on("connection", function (socket) {
    // This callback runs when a new Socket.IO connection is established.
    socket.on("new_user", function (data) {
        socketMap[data["user"]] = socket.id;
    });
    socket.on("new_room", function (data) {
        if (data["admin"] && data["admin"] != "") {
            // TO DO: handle if a room exists with same room name
            const newData = {
                [data["roomname"]]: {
                    "members": [],
                    "password": data["password"],
                    "admin": data["admin"],
                    "banList": []
                }
            }
            allRooms.roomNames.push(data["roomname"]);
            // check if created room exists or not then add to new data if necessary
            if (allRooms.rooms) {
                // '...' is used to add to existing rooms
                allRooms.rooms = { ...allRooms.rooms, ...newData };
            } else {
                allRooms.rooms = newData;
            }
            socket.join(data["roomname"]);
            save();
            socket.emit("room_created", { "message": "Room created successfully!", "room": newData });
            socket.emit("return_rooms", { "rooms": allRooms });
        } else {
            // will return a message negating the login and will not return the room created (maybe?)
            socket.emit("room_created", { "message": "Provide a username.", "room": null });
        }
    });

    socket.on("join_room", function (data) {
        if (data["user"]) {
            if (data["password"] == allRooms.rooms[data["room"]].password) {
                //  if the user is not on the ban list, let them in, else not.
                const index = allRooms.rooms[data["room"]].banList.indexOf(data["user"]);
                // if the user is not in the ban list (-1 means the user's index was not found)
                if (index == -1) {
                    let isAdmin = false;
                    // if the user is the admin user
                    if (data["user"] == allRooms.rooms[data["room"]].admin) {
                        isAdmin = true;
                    }
                    // adds the user to the member list of the room in JSON file
                    allRooms.rooms[data["room"]].members.push(data["user"]);
                    save();
                    socket.join(data["room"]);
                    socket.emit("room_joined", { "message": "Room joined successfully!", "joined": true, "room": allRooms.rooms[data["room"]], "roomname": data["room"], "admin": isAdmin });
                    io.to(data["room"]).emit('update_members', {"members": allRooms.rooms[data["room"]].members});
                } else {
                    socket.emit("room_joined", { "message": "You are banned from this room.", "joined": false });
                }
            } else {
                socket.emit("room_joined", { "message": "Wrong password.", "joined": false });
            }

        } else {
            socket.emit("room_joined", { "message": "Unable to join room", "room": null });
        }
    });

    socket.on("public_msg", function (data) {
        if (data["user"]) {
            // Server expects a js Date() object
            const time = new Date(data["time"]);
            const month = time.getMonth() + 1;
            const messageTime = time.getHours() + ":" + time.getMinutes() + ":" + time.getSeconds() + " on " + month + "/" + time.getDate() + "/" + time.getFullYear();
            io.to(data["room"]).emit("new_public_msg", { "user": data["user"], "message": data["message"], "time": messageTime });
        } else {
            socket.emit("new_public_msg", { "message": "Unable to send message, please provide a username." });
        }
    });

    socket.on("get_rooms", function (data) {
        if (data["user"]) {
            socket.emit("return_rooms", { "rooms": allRooms });
        } else {
            socket.emit("return_rooms", { "rooms": null });
        }
    });

    socket.on("exit_room", function (data) {
        const index = allRooms.rooms[data["room"]].members.indexOf(data["user"]);
        if (index != -1) {
            socket.leave(data["room"]);
            allRooms.rooms[data["room"]].members.splice(index, 1);
            save();
            socket.emit("kick_listen", {"message": "Exited room."});
            socket.emit("exited_room", { "message": "User exited room."});
            io.to(data["room"]).emit('update_members', {"members": allRooms.rooms[data["room"]].members});
        } else {
            socket.emit("exited_room", { "message": "User not found in room." });
        }
    });

    socket.on("pm", function (data) {
        const time = new Date(data["time"]);
        const month = time.getMonth() + 1;
        const messageTime = time.getHours() + ":" + time.getMinutes() + ":" + time.getSeconds() + " on " + month + "/" + time.getDate() + "/" + time.getFullYear();
        // Checks to see if the target user is in the room by checking if they're in the member list
        const index = allRooms.rooms[data["room"]].members.findIndex(member => member == data["target"]);
        // if they'e in the list:
        if (index != -1) {
            // gets target socket id and sends them the message, every client is listening for pms.
            if(data["target"] == data["user"]){
                socket.emit("sent_pm", { "message": "You can't PM yourself!" });
            } else {
                socket.emit("sent_pm", { "message": "PM sent successfully!" });
                socket.to(socketMap[data["target"]]).emit("pm_receive", { "user": data["user"], "message": data["message"], "time": messageTime });
            }
        } else {
            socket.emit("sent_pm", { "message": "Target user is not in the room." });
        }
    });

    socket.on("kick_user", function (data) {
        // if the user is the admin (owner)
       if (data["user"] == allRooms.rooms[data["room"]].admin) {
            const index = allRooms.rooms[data["room"]].members.indexOf(data["target"]);
            // if the target is in the room, kick them
            if (index != -1) {
                // get id of target and kick user from socket.io room
                io.in(socketMap[data["target"]]).socketsLeave(data["room"]);
                // remove target from room member list
                allRooms.rooms[data["room"]].members.splice(index, 1);
                save();
                io.to(data["room"]).emit('update_members', {"members": allRooms.rooms[data["room"]].members});
                // emit a kick to target, will kick them from room and show list of rooms
                //  ** MAKE SURE THE USER IS KICKED BEFORE CALLING "get_rooms" **
                socket.to(socketMap[data["target"]]).emit("kick_listen",{"message": "You have been kicked from the chat."});
                socket.emit("user_kicked", { "message": "User kicked succesfully!" });
            } else {
                socket.emit("user_kicked", { "message": "User is not in the room." });
            }
        } else {
            socket.emit("user_kicked", { "message": "You are not the owner of this room." });
        }
    });

    socket.on("ban_user", function (data) {
        // This is the room from where the ban request was sent froom
        if (allRooms.rooms[data["room"]].admin == data["user"]) {
            let index;
            if (allRooms.rooms[data["room"]].banList.length != 0){
                index = allRooms.rooms[data["room"]].banList.indexOf(data["target"]);
            } else {
                index = -1;
            }
            if (index != -1) {
                socket.emit("user_banned", { "message": "The target user is already banned." });
            } else {
                if (data["user"] == data["target"]) {
                    socket.emit("user_banned", { "message": "You can't ban yourself! We suggest you instead delete the room." });
                } else {
                    // adds user to ban list
                    allRooms.rooms[data["room"]].banList.push(data["target"]);
                    const memberIndex = allRooms.rooms[data["room"]].members.indexOf(data["target"]);
                    // kicks user from room if they're in the room.
                    if (memberIndex != -1) {
                        allRooms.rooms[data["room"]].members.splice(memberIndex, 1);
                        save();
                        io.in(socketMap[data["target"]]).socketsLeave(data["room"]);
                        io.to(data["room"]).emit('update_members', {"members": allRooms.rooms[data["room"]].members});
                        io.to(socketMap[data["target"]]).emit("kick_listen", {"message": "You have been banned from the chat."});
                    } else {
                        save();
                    }
                    socket.emit("user_banned", { "message": "The target user has been banned." });
                }
            }
        } else {
            socket.emit("user_banned", { "message": "You are not the owner of this chat room." });
        }
    });
});

