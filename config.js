const USERS = ["Pratham", "Sakshi"];

const LOGIN = {
  username: "private",
  password: "kalilinux"
};

const ROOM_NAME = "privatechat-two-person-room";

function isAllowedUser(user) {
  return USERS.includes(user);
}

function getPartner(user) {
  if (user === USERS[0]) return USERS[1];
  if (user === USERS[1]) return USERS[0];
  return null;
}

module.exports = {
  USERS,
  LOGIN,
  ROOM_NAME,
  isAllowedUser,
  getPartner
};
