const Client = require("./structs/client.struct");
const client = require("./modules/client");
const Discord = require("discord.js");
const chalk = require("chalk");
const constants = client.getModule("constants");
const { Op } = require("./modules/sql");
const { models: { guildinfo, blacklist, orders, stocks }, models, prefix: defaultPrefix, sequelize } = client.getModule("sql");
const { errors } = constants;

// DEFINITIONS
Object.defineProperty(Error.prototype, "short", {
	get() {
		return `${this.name}: ${this.message}`;
	}
});

Object.defineProperty(Error.prototype, "shortcolors", {
	get() {
		return `${chalk.redBright(this.name)}: ${chalk.red(this.message)}`;
	}
});

Object.defineProperty(Discord.GuildMember.prototype, "isEmployee", {
	get() {
		return this.roles.has(client.mainRoles.employee.id) && this.guild.id === client.mainGuild.id;
	}
});

Object.defineProperty(Discord.GuildMember.prototype, "tag", {
	get() {
		return `${this.displayName}#${this.user.discriminator}`;
	}
});

const _send = Discord.TextChannel.prototype.send;
const _edit = Discord.Message.prototype.edit;

Discord.TextChannel.prototype.send = async function send(content, ...params) {
	return _send.call(this, client.utils.messageContent(this, content), ...params);
};
Discord.DMChannel.prototype.send = async function send(content, ...params) {
	return _send.call(this, client.utils.messageContent(this, content), ...params);
};
Discord.Message.prototype.edit = async function edit(content, ...params) {
	return _edit.call(this, client.utils.messageContent(this, content), ...params);
};

client.log("Starting bot...");

client.on("modelsLoaded", async() => {
	const workerinfo = client.getModel("workerinfo");
	// workerinfo instance methods
	workerinfo.prototype.getStats = function getStats(startTime = 0, endTime = Infinity) {
		const timedOrders = client.cached.orders.filter(x => x.createdAt >= startTime && x.createdAt <= endTime);
		const stats = {
			ordersCooked: timedOrders.filter(x => x.claimer === this.id && x.status > 1),
			ordersDelivered: timedOrders.filter(x => x.deliverer === this.id && x.status === 4)
		};
		stats.cooks = stats.ordersCooked.length;
		stats.delivers = stats.ordersDelivered.length;
		stats.total = stats.cooks + stats.delivers;
		return stats;
	};
	workerinfo.prototype.getUser = function getUser() {
		const user = client.users.get(this.id) || {};
		return {
			id: this.id,
			username: user.username || this.tag,
			tag: user.tag || this.tag
		};
	};
});

client.on("ready", async() => {
	await client.loadModels();
	await client.user.setActivity("Just started! Order donuts!");
	client.getModule("extensions");
	const authenErr = await sequelize.authenticate();
	if (authenErr) client.error(`${chalk.yellow("Database")} failed to load. ${chalk.red(authenErr)}`);
	require("./website/server");
	client.log(`${chalk.blueBright("Website loaded!")}`);
	client.log(`${chalk.cyanBright("Bot started!")} Logged in at ${chalk.bold(client.user.tag)}. ID: ${chalk.blue(client.user.id)}`);
	client.log(`Currently in ${chalk.greenBright(client.guilds.size)} guild(s)!`);
});

client.on("guildMemberUpdate", async(oldM, newM) => {
	if (oldM.isEmployee && !newM.isEmployee) {
		client.emit("fire", newM);
	}

	if (!oldM.isEmployee && newM.isEmployee) {
		client.emit("hire", newM);
	}
});

client.on("guildMemberRemove", async member => {
	if (member.isEmployee) client.emit("fire", member);
});

client.on("fire", member => {
	client.log(`oh fuck, ${member.tag} is fired.`);
});

client.on("hire", member => {
	client.log(`oh yay, ${member.tag} is hired.`);
});

client.on("messageUpdate", async(oldMessage, newMessage) => {
	if (oldMessage.createdAt < Date.now() - 30000) return;
	client.emit("message", newMessage);
});

client.on("message", async message => {
	if (!client.started) return process.exit();
	if (!message.guild) return;
	message.author.hasOrder = Boolean(await orders.findOne({ where: { user: message.author.id, status: { [Op.lt]: 4 } } }));
	message.author.order = await orders.findOne({ where: { status: { [Op.lt]: 4 }, user: message.author.id } });
	message.channel.assert = async function assert(id) {
		if (this.id !== id) {
			await this.send(client.errors.channel.format(id));
			throw new client.classes.WrongChannelError(`Expected channel ${id} but instead got ${this.id}.`);
		}
	};


	message.guild.info = await (await guildinfo.findOrCreate({ where: { id: message.guild.id }, defaults: { id: message.guild.id } }))[0];
	message.author.lastOrder = await orders.findOne({ where: { user: message.author.id }, order: [["createdAt", "DESC"]] });
	const prefixes = [defaultPrefix, `<@${client.user.id}>`, `<@!${client.user.id}>`, message.guild.info.prefix];
	const prefix = prefixes.find(x => message.content.startsWith(x));
	if (!prefix) return;

	message.content = message.content.replace(prefix, "").trim();
	message.permissions = message.channel.permissionsFor(client.user.id).toArray();
	const args = message.content.match(/('.*?'|".*?"|\S+)/g).map(x => x.replace(/^"(.+(?="$))"$/, "$1"));
	message.arguments = args;
	const command = args.shift();

	message.argError = async function argError() {
		await this.channel.send(client.errors.arguments.format(this.command.prefix, this.command.inputName, this.command.instance.syntax));
		throw new client.classes.IncorrectArgumentsError(`Incorrect arguments for command ${this.command.name}.`);
	};

	// COMMAND INFO START
	if (!client.getCommand(command)) return;
	if (client.cached.blacklist.some(x => [message.author.id, message.guild.id, message.channel.id].includes(x.id))) return message.channel.send(client.errors.blacklisted);
	if (client.constants.permissionFlags.find(x => !message.permissions.includes(x))) {
		return message.channel.send(`Sorry, the command failed to process because I do not have enough permissions in this channel.
I require the following permissions to be added:
${client.constants.permissionFlags.filter(x => !message.permissions.includes(x)).map(x => `\`${x}\``).join(", ")}`);
	}
	let strings = client.constants.languages[message.guild.info.language];
	if (!strings) strings = client.constants.languages.english;

	try {
		const gcommand = await client.getCommand(command);
		message.command = {
			onRecieved: process.hrtime.bigint(),
			name: gcommand.name,
			prefix,
			inputName: command,
			instance: gcommand
		};
		if (!gcommand.execPermissions(client, message.member)) return message.channel.send(client.errors.permissions);
		await gcommand.exec(client, message, args, strings);
	} catch (err) {
		if (err instanceof client.classes.EndCommand) return;
		await message.channel.send(client.errors.codes[err.code] || `${errors.internal}
\`\`\`js
${err.stack}
\`\`\`
		`);
		client.error(err.stack);
	}
});
/*
* SQL OnUpdate
*/
orders.afterCreate(async(order, options) => {
	const tm = await client.mainChannels.ticket.send(client.createTicket(order));
	await order.update({ message: tm.id, expireFinish: Date.now() + client.constants.times.expire });
});

orders.beforeDestroy(async(order, options) => {
	await client.users.get(order.user).send("Sorry! Due to unexpected issues, your order was deleted.");
});

orders.beforeUpdate(async(order, options) => {
	if (order.status > 3) {
		if (await client.mainChannels.ticket.messages.fetch(order.message)) {
			const tm = await client.mainChannels.ticket.messages.fetch(order.message);
			await tm.delete();
		}
	} else {
		const tm = await client.mainChannels.ticket.messages.fetch(order.message);
		if (!tm || !tm.edit) return order.destroy();
		tm.edit(client.createTicket(order));
	}
	if (!options.fields.includes("status")) return;
	if (!client.users.get(order.user)) return order.destroy();
	if (!client.channels.get(order.channel)) return order.destroy();
	if (order.status < 4 && order.message && !client.mainChannels.ticket.messages.fetch(order.message)) return order.destroy();
	switch (order.status) {
		case 2: {
			if (!order.url) return order.update({ status: 1 });
			await client.users.get(order.user).send(`Your order is now cooking. It will take ${((order.cookFinish - Date.now()) / 60000).toFixed(2)} minutes to finish cooking.`);
			break;
		}
		case 3: {
			await client.mainChannels.delivery.send(`<@${order.claimer}>, order \`${order.id}\` has finished cooking and is ready to be delivered!`);
			await client.users.get(order.user).send(`Your order has finished cooking. A deliverer will shortly head over to your server and deliver your donut.`);
			await order.update({ deliverFinish: Date.now() + client.constants.times.deliver });
			break;
		}
		case 4: {
			if (!order.deliverer) {
				await client.channels.get(order.channel).send(`<@${order.user}> Here is your donut! ${order.url}
Rate your cook using \`d!rate [1-5]\`.
If you enjoy our services and want to support us, donate at <https://patreon.com/discorddonuts>!
Have a great day!
`);
				return client.mainChannels.delivery.send(`Order \`${order.id}\` has been automatically delivered.`);
			}
			break;
		}
		case 6: {
			await client.users.get(order.user).send(client.errors.expired);
			break;
		}
	}
});

orders.beforeBulkUpdate(async options => {
	options.individualHooks = true;
});

process.on("unhandledRejection", (err, p) => {
	if (!process.extensionsLoaded) client.getModule("extensions");
	if (err.name.equalsAny("TimeoutError", "SequelizeConnectionError")) {
		client.status = 1;
		return client.error(err);
	}
	client.error(err.stack);
});

client.login(`Bot ${client.auth.token}`);
