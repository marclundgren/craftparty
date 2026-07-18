package party.craft.stayhydrated;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.alchemy.Potions;
import net.minecraft.world.item.alchemy.PotionContents;

import java.io.IOException;
import java.lang.reflect.Type;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Server-side thirst. Vanilla clients see the meter on the action bar
 * (just above the hunger bar) and drink with the completely vanilla
 * water-bottle mechanic — no client mod needed.
 *
 * Balance targets: a full meter is 20 points and a sip restores 6. At
 * rest a player needs ~8 sips per Minecraft day (about what a person
 * drinks in a real day); sprinting and direct sun each multiply thirst
 * and they compound. A bottle survives a sip 75% of the time, so a
 * bottle averages four sips before it needs refilling at any water
 * source (the vanilla mechanic).
 */
public final class StayHydrated implements ModInitializer {
    private static final double MAX_THIRST = 20.0;
    private static final double SIP_POINTS = 6.0;
    /** ~8 sips/day at rest: 8 * 6 points / 24000 ticks. */
    private static final double BASE_LOSS_PER_TICK = 8.0 * SIP_POINTS / 24000.0;
    private static final double SPRINT_MULTIPLIER = 2.5;
    private static final double SUN_MULTIPLIER = 1.75;
    private static final double BOTTLE_SURVIVES_SIP_CHANCE = 0.75;
    private static final int DISPLAY_EVERY_TICKS = 20;
    private static final String STATE_FILE = "craftparty-hydration.json";

    private final Map<UUID, Double> thirst = new HashMap<>();
    /** Hand a player is currently drinking a water bottle from. */
    private final Map<UUID, InteractionHand> drinking = new HashMap<>();
    private int ticks = 0;

    @Override
    public void onInitialize() {
        ServerLifecycleEvents.SERVER_STARTED.register(this::load);
        ServerLifecycleEvents.SERVER_STOPPING.register(this::save);
        ServerTickEvents.END_SERVER_TICK.register(this::tick);
    }

    private void tick(MinecraftServer server) {
        ticks++;
        if (ticks % (20 * 300) == 0) save(server);

        for (ServerPlayer player : server.getPlayerList().getPlayers()) {
            if (player.isSpectator() || player.isCreative()) continue;
            UUID id = player.getUUID();
            double level = thirst.getOrDefault(id, MAX_THIRST);

            trackDrinking(player, id);

            double loss = BASE_LOSS_PER_TICK;
            if (player.isSprinting()) loss *= SPRINT_MULTIPLIER;
            if (inTheSun(player)) loss *= SUN_MULTIPLIER;
            level = Math.max(0.0, level - loss);
            thirst.put(id, level);

            applyEffects(player, level);
            if (ticks % DISPLAY_EVERY_TICKS == 0) showMeter(player, level);
        }
    }

    /**
     * Vanilla handles the whole drink (animation, sounds, glass bottle
     * back). We watch for a finished water-bottle drink: the player was
     * using one, stopped, and the bottle in that hand turned to glass.
     */
    private void trackDrinking(ServerPlayer player, UUID id) {
        if (player.isUsingItem() && isWaterBottle(player.getUseItem())) {
            drinking.put(id, player.getUsedItemHand());
            return;
        }
        InteractionHand hand = drinking.remove(id);
        if (hand == null) return;
        // Potions don't stack, so a finished drink always leaves the empty
        // glass bottle in the same hand; anything else was an abort.
        if (player.getItemInHand(hand).is(Items.GLASS_BOTTLE)) {
            onSip(player, id, hand);
        }
    }

    private void onSip(ServerPlayer player, UUID id, InteractionHand hand) {
        double level = Math.min(MAX_THIRST, thirst.getOrDefault(id, MAX_THIRST) + SIP_POINTS);
        thirst.put(id, level);

        // Most sips don't finish the bottle: put the water back so one
        // bottle averages several sips before refilling.
        if (ThreadLocalRandom.current().nextDouble() < BOTTLE_SURVIVES_SIP_CHANCE
                && player.getItemInHand(hand).is(Items.GLASS_BOTTLE)) {
            player.setItemInHand(hand, waterBottleProbe());
        }
        showMeter(player, level);
    }

    private static ItemStack waterBottleProbe() {
        ItemStack stack = new ItemStack(Items.POTION);
        stack.set(DataComponents.POTION_CONTENTS, new PotionContents(Potions.WATER));
        return stack;
    }

    private static boolean isWaterBottle(ItemStack stack) {
        if (!stack.is(Items.POTION)) return false;
        PotionContents contents = stack.get(DataComponents.POTION_CONTENTS);
        return contents != null && contents.is(Potions.WATER);
    }

    private static boolean inTheSun(ServerPlayer player) {
        ServerLevel level = player.level() instanceof ServerLevel sl ? sl : null;
        if (level == null) return false;
        // The nether counts as always scorching.
        if (level.dimension() == net.minecraft.world.level.Level.NETHER) return true;
        if (!level.dimensionType().hasSkyLight()) return false;
        BlockPos pos = player.blockPosition().above();
        return level.isBrightOutside() && !level.isRaining() && level.canSeeSky(pos);
    }

    private void applyEffects(ServerPlayer player, double level) {
        if (ticks % 40 != 0) return;
        if (level <= 0.01) {
            player.addEffect(new MobEffectInstance(MobEffects.SLOWNESS, 60, 1, true, false));
            player.addEffect(new MobEffectInstance(MobEffects.WEAKNESS, 60, 0, true, false));
            // Parched, not lethal: never drops a player below one heart.
            if (ticks % 80 == 0 && player.getHealth() > 2.0F) {
                player.hurtServer((ServerLevel) player.level(),
                        player.damageSources().starve(), 1.0F);
            }
        } else if (level <= 6.0) {
            player.addEffect(new MobEffectInstance(MobEffects.SLOWNESS, 60, 0, true, false));
        }
    }

    private static void showMeter(ServerPlayer player, double level) {
        int filled = (int) Math.round(level / 2.0);
        MutableComponent bar = Component.literal("Thirst ")
                .withStyle(ChatFormatting.GRAY);
        MutableComponent drops = Component.literal("●".repeat(Math.max(0, filled)))
                .withStyle(ChatFormatting.AQUA);
        MutableComponent empty = Component.literal("○".repeat(Math.max(0, 10 - filled)))
                .withStyle(ChatFormatting.DARK_GRAY);
        player.sendSystemMessage(bar.append(drops).append(empty), true);
    }

    // ---- persistence (JSON in the world/run directory) ----

    private static final Gson GSON = new Gson();
    private static final Type STATE_TYPE = new TypeToken<Map<String, Double>>() {}.getType();

    private void load(MinecraftServer server) {
        try {
            Path file = server.getServerDirectory().resolve(STATE_FILE);
            if (!Files.exists(file)) return;
            Map<String, Double> raw = GSON.fromJson(
                    Files.readString(file, StandardCharsets.UTF_8), STATE_TYPE);
            if (raw == null) return;
            raw.forEach((k, v) -> thirst.put(UUID.fromString(k), v));
        } catch (IOException | RuntimeException ignored) {
            // best effort — everyone just starts fully hydrated
        }
    }

    private void save(MinecraftServer server) {
        try {
            Map<String, Double> raw = new HashMap<>();
            thirst.forEach((k, v) -> raw.put(k.toString(), v));
            Files.writeString(server.getServerDirectory().resolve(STATE_FILE),
                    GSON.toJson(raw), StandardCharsets.UTF_8);
        } catch (IOException ignored) {
            // best effort
        }
    }
}
