package party.craft.welcomeparty;

import it.unimi.dsi.fastutil.ints.IntList;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.minecraft.ChatFormatting;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.game.ClientboundSetSubtitleTextPacket;
import net.minecraft.network.protocol.game.ClientboundSetTitleTextPacket;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.projectile.FireworkRocketEntity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.component.FireworkExplosion;
import net.minecraft.world.item.component.Fireworks;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

/**
 * A hero's welcome for every friend who joins: a short fireworks show
 * around their spawn point and a celebration banner for everyone.
 * Entirely server-side — vanilla clients see all of it.
 */
public final class WelcomeParty implements ModInitializer {
    private static final int ROCKETS = 6;
    private static final int TICKS_BETWEEN_ROCKETS = 12;

    /** Pending shows: player UUID -> rockets left (fired on a timer). */
    private final List<Show> shows = new ArrayList<>();
    private int ticks = 0;

    private record Show(UUID player, int[] remaining) {}

    @Override
    public void onInitialize() {
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> {
            ServerPlayer player = handler.getPlayer();
            announce(server, player);
            shows.add(new Show(player.getUUID(), new int[] { ROCKETS }));
        });
        ServerTickEvents.END_SERVER_TICK.register(this::tick);
    }

    private void announce(MinecraftServer server, ServerPlayer joined) {
        Component title = Component.literal("★ " + joined.getGameProfile().name() + " ★")
                .withStyle(ChatFormatting.GOLD, ChatFormatting.BOLD);
        Component subtitle = Component.literal("joined the party!")
                .withStyle(ChatFormatting.YELLOW);
        for (ServerPlayer p : server.getPlayerList().getPlayers()) {
            p.connection.send(new ClientboundSetTitleTextPacket(title));
            p.connection.send(new ClientboundSetSubtitleTextPacket(subtitle));
        }
        server.getPlayerList().broadcastSystemMessage(
                Component.literal("★ ")
                        .withStyle(ChatFormatting.GOLD)
                        .append(Component.literal(joined.getGameProfile().name())
                                .withStyle(ChatFormatting.AQUA))
                        .append(Component.literal(" joined the party! Make some noise!")
                                .withStyle(ChatFormatting.YELLOW)),
                false);
    }

    private void tick(MinecraftServer server) {
        ticks++;
        if (shows.isEmpty() || ticks % TICKS_BETWEEN_ROCKETS != 0) return;
        Iterator<Show> it = shows.iterator();
        while (it.hasNext()) {
            Show show = it.next();
            ServerPlayer player = server.getPlayerList().getPlayer(show.player());
            if (player == null || show.remaining()[0] <= 0) {
                it.remove();
                continue;
            }
            show.remaining()[0]--;
            launchRocket(player);
        }
    }

    private static void launchRocket(ServerPlayer player) {
        if (!(player.level() instanceof ServerLevel level)) return;
        ThreadLocalRandom rng = ThreadLocalRandom.current();
        double x = player.getX() + rng.nextDouble(-3.5, 3.5);
        double z = player.getZ() + rng.nextDouble(-3.5, 3.5);

        ItemStack rocket = new ItemStack(Items.FIREWORK_ROCKET);
        FireworkExplosion explosion = new FireworkExplosion(
                randomShape(rng),
                IntList.of(randomColor(rng), randomColor(rng)),
                IntList.of(randomColor(rng)),
                rng.nextBoolean(),
                rng.nextBoolean());
        rocket.set(DataComponents.FIREWORKS, new Fireworks(1, List.of(explosion)));

        level.addFreshEntity(new FireworkRocketEntity(level, x, player.getY(), z, rocket));
    }

    private static FireworkExplosion.Shape randomShape(ThreadLocalRandom rng) {
        FireworkExplosion.Shape[] shapes = {
            FireworkExplosion.Shape.LARGE_BALL,
            FireworkExplosion.Shape.BURST,
            FireworkExplosion.Shape.STAR,
            FireworkExplosion.Shape.SMALL_BALL,
        };
        return shapes[rng.nextInt(shapes.length)];
    }

    private static int randomColor(ThreadLocalRandom rng) {
        int[] palette = {
            0x55FFFF, 0xFF55FF, 0xFFAA00, 0x55FF55, 0xFF5555, 0xFFFF55, 0xAA00FF,
        };
        return palette[rng.nextInt(palette.length)];
    }
}
