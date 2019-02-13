const Discord = require("discord.js");
const Client = require("./client.struct");
const perms = require("../modules/permissions");
const { execPermission } = require("../modules/utils");
module.exports = class Command {
	constructor(name, description, permissions) {
		this.name = name;
		this.description = description;
		this.permissions = permissions;
		this.aliases = [];
		this.shortcuts = [];
		this.hidden = false;
		this.category = "none";
	}
	setFunction(exec) {
		this.exec = exec;
		return this;
	}
	setAlias(...aliases) {
		this.aliases = aliases;
		return this;
	}
	setShortcut(...shortcuts) {
		this.shortcuts = shortcuts;
		return this;
	}
	setHidden(bool = false) {
		this.hidden = bool;
		return this;
	}
	exec(client = new Client(), message = new Discord.Message, args = []) {
		return message.channel.send("No function has been set for this command.");
	}
	execPermissions(client = new Client(), member = new Discord.GuildMember) {
		return execPermission(this.permissions, client, member);
	}
};
